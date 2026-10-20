<script lang="ts">
  import { fly } from 'svelte/transition';
  import { Share2 } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.js';
  import Card from '#lib/components/Card.svelte';
  import PlayerSeat from '#lib/components/PlayerSeat.svelte';
  import { cantoName } from '#lib/command-labels.js';
  import { eventLabel } from '#lib/game-events.js';
  import { teamLabel, victoryLabel } from '#lib/team-labels.js';
  import type { Snapshot } from '#lib/protocol.js';

  let {
    snapshot,
    seconds,
    myTurn,
    oninvite,
  }: {
    snapshot: Snapshot;
    seconds: number;
    myTurn: boolean;
    oninvite: () => void;
  } = $props();

  let game = $derived(snapshot.state);
  let perspective = $derived(snapshot.seat < 0 ? snapshot.perspective : snapshot.seat);
  let respondingTeam = $derived(game?.pending ? 1 - game.pending.caller : undefined);
  let latestEvent = $derived(snapshot.events?.at(-1)?.event);

  function seatName(seat: number) {
    return snapshot.seats[seat]?.name ?? 'Puesto libre';
  }

  function announcement(seat: number) {
    const events = snapshot.events ?? [];
    for (let index = events.length - 1; index >= 0; index--) {
      const item = events[index];
      if (item.event.automatic && item.event.type === 'respond') continue;
      if (item.event.seat === seat && item.hand === game?.handNumber) {
        const label = eventLabel(item.event);
        if (label) return label;
      }
    }
    return '';
  }

  function position(seat: number) {
    const relative = (seat - perspective + snapshot.config.players) % snapshot.config.players;
    if (snapshot.config.players === 2) return relative === 0 ? 'bottom' : 'top';
    return ['bottom', 'right', 'top', 'left'][relative];
  }
</script>

<section
  class="felt-table"
  class:four-player={snapshot.config.players === 4}
  aria-label="Mesa de truco"
>
  {#if latestEvent?.automatic && latestEvent.type === 'respond'}
    <div class="team-response" role="status">
      {teamLabel(latestEvent.seat % 2, snapshot.seat)}: {eventLabel(latestEvent)}
    </div>
  {/if}
  <div class="table-outline" aria-hidden="true"></div>
  <div class="scoreboard" aria-label="Marcador">
    <div>
      <span>{teamLabel(0, snapshot.seat)}</span>
      <strong>{game?.scores[0] ?? 0}</strong>
    </div>
    <span class="score-target">A {snapshot.config.target}</span>
    <div>
      <span>{teamLabel(1, snapshot.seat)}</span>
      <strong>{game?.scores[1] ?? 0}</strong>
    </div>
  </div>

  {#each Array.from({ length: snapshot.config.players }, (_, seat) => seat) as seat (seat)}
    <div class={['seat', 'seat-' + position(seat)]}>
      <PlayerSeat
        name={seatName(seat)}
        team={teamLabel(seat % 2, snapshot.seat)}
        remaining={game?.seats[seat].remaining ?? 3}
        self={seat === snapshot.seat}
        mano={seat === game?.mano}
        announcement={announcement(seat)}
        active={game?.turn === seat && !game.pending && game.phase === 'playing'}
        answering={respondingTeam === seat % 2}
      />
    </div>
  {/each}

  <div class="play-zone">
    <svg class="direction-ring" viewBox="0 0 360 360" fill="none" aria-hidden="true">
      <circle cx="180" cy="180" r="174" stroke-dasharray="3 13" />
      <circle cx="180" cy="180" r="156" />
      <path d="M 306 92 A 154 154 0 0 0 64 82 M 64 82 l 2 -25 M 64 82 l 26 -1" />
      <path d="M 54 268 A 154 154 0 0 0 296 278 M 296 278 l -2 25 M 296 278 l -26 1" />
    </svg>
    <div class="table-watermark" aria-hidden="true">r.</div>
    {#if game}
      {#each game.seats as seat, index (index)}
        <div
          class={['played-group', 'played-' + position(index)]}
          aria-label={'Cartas de ' + seatName(index)}
        >
          {#each seat.plays as play, round (round)}
            {#if play.present}
              <div
                class={['played-card', { burned: play.burned }]}
                style:--tilt={round * 7 - 7 + 'deg'}
                in:fly={{ y: 28, duration: 180 }}
              >
                <Card card={play.card} hidden={!play.card} width={70} />
                <span>{play.burned ? 'Quemada' : round + 1 + '.ª'}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  {#if game?.vira}
    <div class={['deck', 'deck-' + position((game.dealer + 1) % snapshot.config.players)]}>
      <div class="deck-back"><Card hidden width={54} /></div>
      <div class="vira">
        <Card card={game.vira} width={54} />
        <span>LA VIRA</span>
      </div>
    </div>
  {/if}

  <div
    class={[
      'table-status',
      {
        expanded: !game || game.phase !== 'playing',
        results: game?.phase === 'hand_over' || game?.phase === 'match_over',
      },
    ]}
  >
    {#if game && (game.phase === 'cutting' || game.phase === 'hand_over')}
      <span class="phase-countdown" aria-label={seconds + ' segundos restantes'}>{seconds}s</span>
    {/if}
    {#if !game}
      <span class="status-eyebrow">La mesa está puesta</span>
      <h1>Faltan {snapshot.config.players - snapshot.seats.length} para repartir.</h1>
      <p>Invita a tus panas. Aquí los esperamos.</p>
      <Button onclick={oninvite}><Share2 size={16} />Invitar a mis amigos</Button>
    {:else if game.phase === 'match_over'}
      <span class="status-eyebrow">La partida tiene ganador</span>
      <h1>{victoryLabel(game.winner, snapshot.seat)}</h1>
      <p>{game.scores[0]} — {game.scores[1]}</p>
      {#if game.envidoResults?.length}
        <div class="envido-results" aria-label="Valores de envido">
          {#each game.envidoResults as result (result.seat)}
            <span>{seatName(result.seat)}: {result.eligible ? result.value : 'Flor inválida'}</span>
          {/each}
        </div>
      {/if}
      <Button href={resolve('/')}>Volver a las mesas</Button>
    {:else if game.phase === 'hand_over'}
      <span class="status-eyebrow">Se cierra la mano</span>
      <h2>La próxima ya viene.</h2>
      {#if game.envidoResults?.length}
        <div class="envido-results" aria-label="Valores de envido">
          {#each game.envidoResults as result (result.seat)}
            <span>{seatName(result.seat)}: {result.eligible ? result.value : 'Flor inválida'}</span>
          {/each}
        </div>
      {/if}
      {#each game.payouts as payout, i (i)}
        <p>{teamLabel(payout.team, snapshot.seat)}: +{payout.points} de {payout.kind}</p>
      {/each}
    {:else if game.phase === 'cutting'}
      <span class="status-eyebrow">Antes de repartir</span>
      <h2>
        {game.turn === snapshot.seat ? 'Te toca partir.' : seatName(game.turn) + ' parte el mazo.'}
      </h2>
      <p>Elige dónde cortar las 40 cartas.</p>
    {:else}
      <div class="turn-message">
        <span class="turn-dot"></span>
        {#if game.pending}
          <strong>{cantoName(game.pending.kind)}</strong>
          <span class="wager-value">
            {game.pending.value === 100 ? 'Vale partida' : game.pending.value + ' piedras'}
          </span>
        {:else}
          <strong>{myTurn ? 'Tu turno' : 'Juega ' + seatName(game.turn)}</strong>
        {/if}
        <span
          class={['timer', { urgent: seconds <= 10 }]}
          aria-label={seconds + ' segundos restantes'}
        >
          {seconds}s
        </span>
      </div>
      {#if game.pending}
        <p>
          Responde: {teamLabel(1 - game.pending.caller, snapshot.seat)}{game.suspended
            ? ' · Truco en espera'
            : ''}
        </p>
      {:else}
        <p>
          {game.round + 1}.ª vuelta{game.mandatoryStack
            ? ' · Todos juegan pegado'
            : ' · Antihorario'}
        </p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .felt-table {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* Keep the seat, turn message, and played cards in separate vertical bands. */
    grid-template-rows: 140px auto minmax(280px, 1fr);
    padding-bottom: 20px;
    color: #f1f0e6;
    overflow: hidden;
  }
  .team-response {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 12px;
    background: #e9e2bd;
    color: #20372b;
    border-radius: 8px;
    font-size: 10px;
    z-index: 8;
  }
  .table-outline {
    position: absolute;
    inset: 10% 4% 12%;
    border: 1px solid #9bbfab0d;
    border-radius: 50%;
    box-shadow:
      0 0 0 35px #90b9a103,
      0 0 0 80px #90b9a102;
  }
  .scoreboard {
    position: absolute;
    top: 22px;
    left: 28px;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 20px;
    border: 1px solid #b9c6b91c;
    border-radius: 14px;
    background: #10251c80;
  }
  .scoreboard > div {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .scoreboard span {
    font-size: 9px;
    color: #9eb6a6;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .scoreboard strong {
    font-size: 22px;
    font-weight: 600;
  }
  .score-target {
    border-inline: 1px solid #92ac9826;
    padding-inline: 14px;
  }
  .seat {
    position: absolute;
    z-index: 3;
  }
  .seat-top {
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
  }
  .seat-left {
    top: 230px;
    left: 5%;
    transform: rotate(-3deg);
  }
  .seat-right {
    top: 230px;
    right: 5%;
    transform: rotate(3deg);
  }
  .seat-bottom {
    bottom: 32px;
    left: 28px;
  }
  .play-zone {
    position: relative;
    grid-column: 1;
    grid-row: 3;
    place-self: center;
    width: min(460px, calc(100% - 24px));
    height: 280px;
  }
  .direction-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    stroke: #a1c6ae;
    stroke-width: 1;
    opacity: 0.14;
  }
  .table-watermark {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font:
      italic 70px Georgia,
      serif;
    opacity: 0.06;
  }
  .played-group {
    position: absolute;
    display: flex;
    justify-content: center;
    min-width: 70px;
  }
  .played-top {
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
  }
  .played-bottom {
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
  }
  .played-left {
    left: 0;
    top: 50%;
    transform: translateY(-50%) rotate(-8deg);
  }
  .played-right {
    right: 0;
    top: 50%;
    transform: translateY(-50%) rotate(8deg);
  }
  .played-card {
    position: relative;
    transform: rotate(var(--tilt));
    filter: drop-shadow(0 7px 7px #041a1640);
  }
  .played-card + .played-card {
    margin-left: -35px;
  }
  .played-card span {
    display: block;
    text-align: center;
    font-size: 8px;
    color: #b8c9b8;
    margin-top: 5px;
  }
  .burned {
    opacity: 0.4;
  }
  .deck {
    position: absolute;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    z-index: 1;
  }
  .deck-top {
    top: 110px;
    left: 28px;
    transform: rotate(-10deg);
  }
  .deck-right {
    top: 110px;
    right: 28px;
    transform: rotate(10deg);
  }
  .deck-bottom {
    bottom: 120px;
    left: 28px;
    transform: rotate(-10deg);
  }
  .deck-left {
    top: 110px;
    left: 28px;
    transform: rotate(10deg);
  }
  .deck-back {
    border-radius: 5px;
    box-shadow:
      -2px 2px #d6d5bd,
      -4px 4px #263a2c,
      -6px 6px #b0b4a0;
  }
  .vira span {
    display: block;
    text-align: center;
    font-size: 8px;
    letter-spacing: 0.12em;
    margin-top: 7px;
    color: #b4c7ae;
  }
  .table-status {
    position: relative;
    grid-column: 1;
    grid-row: 2;
    place-self: center;
    margin-bottom: 16px;
    z-index: 4;
    text-align: center;
  }
  .turn-message {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 15px;
    border: 1px solid #a5b5a62b;
    border-radius: 11px;
    background: #122a24e8;
    white-space: nowrap;
    box-shadow: 0 8px 20px #081b1726;
  }
  .turn-message strong {
    font-size: 12px;
  }
  .turn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #d9cd94;
    box-shadow: 0 0 12px #d9cd9440;
  }
  .wager-value {
    font-size: 10px;
    color: #c5cfb3;
  }
  .timer {
    font-size: 10px;
    color: #9db8a4;
    border-left: 1px solid #b1c6ac26;
    padding-left: 12px;
  }
  .timer.urgent {
    color: #ffc297;
  }
  .table-status p {
    color: #a7bfaa;
    font-size: 10px;
    margin-top: 9px;
  }
  .expanded {
    position: absolute;
    grid-row: auto;
    top: 36%;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, 88%);
    padding: 24px;
    background: #142e26f2;
    border: 1px solid #a5b5a62b;
    border-radius: 20px;
    box-shadow: 0 15px 70px #071a1640;
  }
  .expanded h1,
  .expanded h2 {
    font-size: 28px;
    margin-top: 12px;
    line-height: 1.2;
  }
  .expanded p {
    font-size: 12px;
    margin: 12px 0;
  }
  .expanded :global(button),
  .expanded :global(a) {
    margin-top: 12px;
  }
  .status-eyebrow {
    font-size: 9px;
    letter-spacing: 0.13em;
    color: #c5ccac;
    text-transform: uppercase;
  }
  .phase-countdown {
    display: block;
    margin-bottom: 12px;
    color: #d8cb93;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .envido-results {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 16px;
    font-size: 11px;
    color: #e1dec0;
  }
  @media (max-height: 800px) and (min-width: 651px) {
    .felt-table {
      grid-template-rows: 115px auto minmax(240px, 1fr);
      padding-bottom: 16px;
    }
    .seat-top {
      top: 36px;
    }
    .play-zone {
      height: 240px;
    }
    .played-card :global(img) {
      width: 56px;
      height: auto;
    }
    .expanded {
      top: 32%;
    }
  }
  @media (max-width: 650px) {
    .felt-table {
      grid-template-rows: 140px auto minmax(220px, 1fr);
    }
    .felt-table.four-player {
      grid-template-rows: 220px auto minmax(220px, 1fr);
    }
    .scoreboard {
      top: 8px;
      left: 12px;
      padding: 8px 10px;
      gap: 10px;
    }
    .scoreboard > div {
      gap: 6px;
    }
    .scoreboard span {
      font-size: 7px;
    }
    .scoreboard strong {
      font-size: 17px;
    }
    .score-target {
      padding-inline: 8px;
    }
    .seat-top {
      top: 80px;
    }
    .seat-left {
      top: 150px;
      left: 10px;
    }
    .seat-right {
      top: 150px;
      right: 10px;
    }
    .seat-bottom {
      display: none;
    }
    .play-zone {
      width: min(330px, calc(100% - 24px));
      height: 220px;
    }
    .played-card :global(img) {
      width: 51px;
      height: auto;
    }
    .played-card + .played-card {
      margin-left: -30px;
    }
    .deck :global(img) {
      width: 34px;
      height: auto;
    }
    .deck-top {
      top: 60px;
      left: 12px;
    }
    .deck-right {
      top: 60px;
      right: 12px;
    }
    .deck-bottom {
      top: 60px;
      bottom: auto;
      left: 12px;
    }
    .deck-left {
      top: 60px;
      left: 12px;
    }
    .turn-message {
      padding: 9px 11px;
      gap: 8px;
    }
    .turn-message strong {
      font-size: 10px;
    }
    .table-status p {
      font-size: 9px;
    }
    .expanded {
      top: 35%;
      padding: 20px;
    }
    .expanded h1,
    .expanded h2 {
      font-size: 25px;
    }
  }

  /* Results can grow with scores and payouts without covering the hand below. */
  .table-status.results {
    position: relative;
    grid-row: 2 / 4;
    top: auto;
    left: auto;
    transform: none;
    margin: 16px 0;
  }
</style>
