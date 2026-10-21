<script lang="ts">
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
    cardsMoving = false,
    oninvite,
  }: {
    snapshot: Snapshot;
    seconds: number;
    myTurn: boolean;
    cardsMoving?: boolean;
    oninvite: () => void;
  } = $props();

  let game = $derived(snapshot.state);
  let missingPlayers = $derived(
    snapshot.config.players - snapshot.seats.filter((seat) => seat.id).length,
  );
  let perspective = $derived(snapshot.seat < 0 ? snapshot.perspective : snapshot.seat);
  let respondingTeam = $derived(game?.pending ? 1 - game.pending.caller : undefined);
  let latestEvent = $derived(snapshot.events?.at(-1)?.event);

  function seatName(seat: number) {
    return snapshot.seats[seat]?.name || 'Puesto libre';
  }

  function announcement(seat: number) {
    const events = snapshot.events ?? [];
    for (let index = events.length - 1; index >= 0; index--) {
      const item = events[index];
      if (item.event.automatic && item.event.type === 'respond') continue;
      if (item.event.seat === seat && item.hand === game?.handNumber) {
        // Playing, stacking, or burning ends this player's turn. Older cantos
        // remain in the match history, but no longer belong above their seat.
        if (['play', 'stack', 'burn'].includes(item.event.type)) return '';
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
  class:active={!!game}
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
      <span>
        {teamLabel(0, snapshot.seat)}{#if game?.privando?.[0]}<small>Privando</small>{/if}
      </span>
      <strong>{game?.scores[0] ?? 0}</strong>
    </div>
    <span class="score-target">A {snapshot.config.target}</span>
    <div>
      <span>
        {teamLabel(1, snapshot.seat)}{#if game?.privando?.[1]}<small>Privando</small>{/if}
      </span>
      <strong>{game?.scores[1] ?? 0}</strong>
    </div>
  </div>

  {#each Array.from({ length: snapshot.config.players }, (_, seat) => seat) as seat (seat)}
    <div class={['seat', 'seat-' + position(seat)]} data-seat={seat}>
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
      {#if game?.vira && seat !== perspective}
        <div class="seat-hand" aria-hidden="true">
          {#each Array.from({ length: game.seats[seat].remaining }, (_, index) => 3 - game.seats[seat].remaining + index) as card (card)}
            <span data-card-back={card}><Card hidden width={20} intro={false} /></span>
          {/each}
        </div>
      {/if}
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
                data-play-seat={index}
                data-play-round={round}
                style:--tilt={round * 7 - 7 + 'deg'}
              >
                <Card card={play.card} hidden={!play.card} width={70} intro={false} />
                <span>{play.burned ? 'Quemada' : round + 1 + '.ª'}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  {#if game}
    <div class={['deck', 'dealer-' + position(game.dealer)]}>
      <div class="deck-back" data-deck><Card hidden width={54} /></div>
      {#if game.vira}
        <div class="vira">
          <Card card={game.vira} width={72} />
          <span>LA VIRA</span>
        </div>
      {/if}
    </div>
  {/if}

  <div
    class={[
      'table-status',
      {
        expanded: !game || game.phase !== 'playing',
        results: game?.phase === 'hand_over' || game?.phase === 'match_over',
        'waiting-for-cards':
          cardsMoving && (game?.phase === 'hand_over' || game?.phase === 'match_over'),
      },
    ]}
  >
    {#if game && (game.phase === 'cutting' || game.phase === 'hand_over')}
      <span class="phase-countdown" aria-label={seconds + ' segundos restantes'}>{seconds}s</span>
    {/if}
    {#if !game}
      <span class="status-eyebrow">La mesa está puesta</span>
      <h1>
        {missingPlayers === 1 ? 'Falta' : 'Faltan'}
        {missingPlayers} para repartir.
      </h1>
      <p>Invita a tus panas. Aquí los esperamos.</p>
      <Button onclick={oninvite}><Share2 size={16} />Invitar a mis amigos</Button>
    {:else if snapshot.cpuPaused}
      <span class="status-eyebrow">Partida en pausa</span>
      <h1>Esperando a los jugadores.</h1>
      <p>La CPU continúa cuando vuelva un jugador a la mesa.</p>
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
          <strong title={cantoName(game.pending.kind)}>{cantoName(game.pending.kind)}</strong>
          <span class="wager-value">
            {game.pending.value === 100 ? 'Vale partida' : game.pending.value + ' piedras'}
          </span>
        {:else}
          <strong title={myTurn ? 'Tu turno' : 'Juega ' + seatName(game.turn)}>
            {myTurn ? 'Tu turno' : 'Juega ' + seatName(game.turn)}
          </strong>
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
    /* Reserve space for the deck on either side of the central playing area.
       Only the row containing the deck grows; player panels never cover it. */
    grid-template-rows: 140px auto var(--side-seat-height, 0px) auto minmax(280px, 1fr) auto 80px;
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
  .scoreboard small {
    display: block;
    margin-top: 3px;
    font-size: 8px;
    color: #e6d59c;
  }
  .score-target {
    border-inline: 1px solid #92ac9826;
    padding-inline: 14px;
  }
  .seat {
    position: absolute;
    z-index: 3;
  }
  .seat-hand {
    position: absolute;
    bottom: 2px;
    left: 9px;
    display: flex;
    pointer-events: none;
  }
  .seat-hand span + span {
    margin-left: -11px;
  }
  .seat-hand span:first-child {
    transform: rotate(-12deg);
  }
  .seat-hand span:last-child {
    transform: rotate(12deg);
  }
  @media (max-width: 650px) {
    .seat-hand {
      left: 5px;
    }
    .seat-hand :global(img) {
      width: 14px;
      height: auto;
    }
    .seat-hand span + span {
      margin-left: -8px;
    }
  }
  .seat-top {
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
  }
  .seat-left {
    position: relative;
    grid-column: 1;
    grid-row: 3;
    place-self: center start;
    margin-left: 5%;
    transform: rotate(-3deg);
  }
  .seat-right {
    position: relative;
    grid-column: 1;
    grid-row: 3;
    place-self: center end;
    margin-right: 5%;
    transform: rotate(3deg);
  }
  .seat-bottom {
    position: relative;
    grid-column: 1;
    grid-row: 7;
    place-self: center;
  }
  .four-player {
    --side-seat-height: 100px;
  }
  .play-zone {
    position: relative;
    grid-column: 1;
    grid-row: 5;
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
      italic 70px 'Nunito Variable',
      sans-serif;
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
    position: relative;
    grid-column: 1;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    /* Leave room for the next seat's canto bubble as well as its panel. */
    margin: 20px 28px 40px;
    z-index: 1;
  }
  /* Right is from the dealer's seat, facing the centre of the table. */
  .dealer-top {
    grid-row: 2;
    justify-self: start;
  }
  .dealer-right {
    grid-row: 2;
    justify-self: end;
  }
  .dealer-bottom {
    grid-row: 6;
    justify-self: end;
  }
  .dealer-left {
    grid-row: 6;
    justify-self: start;
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
    grid-row: 4;
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
      grid-template-rows: 115px auto var(--side-seat-height, 0px) auto minmax(240px, 1fr) auto 80px;
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
      grid-template-rows: 140px auto var(--side-seat-height, 0px) auto minmax(220px, 1fr) auto 0px;
    }
    .felt-table.four-player {
      --side-seat-height: 80px;
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
      margin-left: 10px;
    }
    .seat-right {
      margin-right: 10px;
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
    .deck {
      margin: 16px 16px 40px;
    }
    .vira :global(img) {
      width: 52px;
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
    grid-row: 4 / 6;
    top: auto;
    left: auto;
    transform: none;
    margin: 16px 0;
  }
  .waiting-for-cards {
    visibility: hidden;
  }

  /* A bounded tabletop keeps the four corner spaces and all player positions
     stable. TableViewport fits this stage into the space above the controls. */
  .felt-table.active {
    display: block;
    height: 520px;
    padding: 0;
  }
  .active .seat {
    position: absolute;
    margin: 0;
  }
  .active .seat-top {
    top: 45px;
    left: 50%;
  }
  .active .seat-left,
  .active .seat-right {
    top: 245px;
  }
  .active .seat-left {
    left: 20px;
  }
  .active .seat-right {
    right: 20px;
  }
  .active .seat-bottom {
    bottom: 12px;
    left: 20px;
  }
  .active .table-status:not(.expanded) {
    position: absolute;
    top: 120px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
  }
  .active .play-zone {
    position: absolute;
    top: 200px;
    left: 50%;
    transform: translateX(-50%);
    width: 460px;
    height: 270px;
  }
  .active .played-card :global(img) {
    width: 56px;
    height: auto;
  }
  .active .turn-message {
    max-width: 180px;
    padding: 8px 10px;
    gap: 8px;
  }
  .active .turn-message strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .active .deck {
    position: absolute;
    margin: 0;
    transform: none;
  }
  .active .dealer-top,
  .active .dealer-left {
    left: calc(50% - 230px);
  }
  .active .dealer-right,
  .active .dealer-bottom {
    right: calc(50% - 230px);
  }
  .active .dealer-top,
  .active .dealer-right {
    top: 110px;
  }
  .active .dealer-bottom,
  .active .dealer-left {
    bottom: 10px;
  }
  .active .table-status.expanded {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
  }
  @container (max-width: 900px) {
    .felt-table.active {
      height: 420px;
    }
    .active .scoreboard {
      top: 8px;
      left: 8px;
      padding: 6px 8px;
      gap: 8px;
    }
    .active .scoreboard strong {
      font-size: 19px;
    }
    .active .scoreboard span {
      font-size: 9px;
    }
    .active .seat-top {
      top: 52px;
    }
    .active .seat-left,
    .active .seat-right {
      top: 240px;
    }
    .active .seat-left {
      left: 10px;
    }
    .active .seat-right {
      right: 10px;
    }
    .active .seat-bottom {
      display: none;
    }
    .active .seat :global(.player-seat) {
      width: 90px;
      min-width: 0;
      padding: 6px;
      gap: 5px;
    }
    .active .seat :global(.identity strong) {
      max-width: 48px;
      font-size: 11px;
    }
    .active .seat :global(.identity > span) {
      font-size: 9px;
      gap: 2px;
    }
    .active .seat :global(.identity svg),
    .active .seat :global(.identity i) {
      display: none;
    }
    .active .seat :global(.avatar) {
      width: 22px;
      height: 22px;
    }
    .active .seat :global(.seat-tag) {
      font-size: 8px;
      right: 0;
    }
    .active .seat :global(.speech-bubble) {
      font-size: 9px;
      padding: 4px 6px;
      width: max-content;
      max-width: 130px;
    }
    .active .seat-right :global(.speech-bubble) {
      left: auto;
      right: 0;
    }
    .active .seat-top :global(.speech-bubble) {
      left: calc(100% + 6px);
      bottom: auto;
      top: 0;
      width: max-content;
      max-width: 130px;
    }
    .active .table-status:not(.expanded) {
      top: 106px;
    }
    .active .turn-message {
      padding: 6px 10px;
      gap: 8px;
      max-width: 190px;
    }
    .active .turn-message strong {
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .active .table-status p {
      margin-top: 4px;
      font-size: 10px;
    }
    .active .play-zone {
      top: 160px;
      width: 190px;
      height: 230px;
    }
    .active .played-top {
      top: 0;
    }
    .active .played-bottom {
      bottom: 0;
    }
    .active .played-card :global(img) {
      width: 42px;
      height: auto;
    }
    .active .played-card + .played-card {
      margin-left: -32px;
    }
    .active .deck {
      gap: 6px;
    }
    .active .deck-back :global(img) {
      width: 30px;
      height: auto;
    }
    .active .vira :global(img) {
      width: 56px;
      height: auto;
    }
    .active .dealer-top,
    .active .dealer-left {
      left: 10px;
    }
    .active .dealer-right,
    .active .dealer-bottom {
      right: 10px;
    }
    .active .dealer-top,
    .active .dealer-right {
      top: 80px;
    }
    .active .dealer-bottom,
    .active .dealer-left {
      bottom: 4px;
    }
  }
</style>
