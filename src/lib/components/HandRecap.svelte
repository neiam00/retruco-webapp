<script lang="ts">
  import Card from '#lib/components/Card.svelte';
  import { cardName } from '#lib/cards.js';
  import { eventLabel } from '#lib/game-events.js';
  import { teamLabel } from '#lib/team-labels.js';
  import type { GameEvent, HandRecap as Recap } from '#lib/protocol.js';

  let {
    recap,
    seats,
    viewerSeat,
    events = [],
  }: {
    recap: Recap;
    seats: { name: string }[];
    viewerSeat: number;
    events?: GameEvent[];
  } = $props();

  const reasons: Record<string, string> = {
    two_tricks: 'El mismo equipo ganó las dos primeras vueltas. No hizo falta jugar la tercera.',
    first_and_tie:
      'La segunda vuelta quedó en emparde. Ganó el equipo que había ganado la primera.',
    third_trick: 'Cada equipo ganó una de las dos primeras vueltas. La tercera decidió la mano.',
    third_tie: 'La tercera vuelta quedó en emparde. Ganó el equipo que había ganado la primera.',
    mandatory_top:
      'La primera vuelta quedó en emparde y todos jugaron pegado. La carta de arriba decidió la mano.',
    mandatory_bottom:
      'La primera vuelta y las cartas de arriba empardaron. Decidieron las cartas de abajo.',
    mano_tie: 'Las vueltas decisivas quedaron en emparde. Ganó el equipo de mano.',
    visible_first_and_third:
      'El equipo que ganó la primera también decidió la tercera con las cartas visibles. No hizo falta mostrar las cartas de abajo.',
    truco_declined:
      'No se aceptó el truco o su subida. Ganó el equipo que lo propuso y se pagó el valor anterior de la apuesta.',
    privo_declined:
      'El rival eligió no jugar contra el equipo que privaba. Se pagó una piedra de envido y terminó la partida.',
    privo_flor:
      'Un equipo que privaba tenía flor válida y ganó inmediatamente. Si ambos tenían flor, tuvo prioridad el equipo de mano.',
    flor_presented:
      'Se presentó una flor válida contra el equipo que privaba. La mano terminó con tres piedras de flor, sin pagar truco ni envido.',
    forfeit:
      'Un jugador salió de la mesa y concedió la partida a todo el equipo rival. La salida no añade piedras al marcador.',
  };
  let explanation = $derived(
    reasons[recap.reason] ?? 'La mano terminó con los pagos que aparecen abajo.',
  );
  let cantos = $derived(
    events.filter((item) => item.hand === recap.handNumber && eventLabel(item.event)),
  );

  function seatName(seat: number) {
    return seats[seat]?.name || `Jugador ${seat + 1}`;
  }

  function outcome(trick: Recap['tricks'][number]) {
    switch (trick.status) {
      case 'won':
        return `${teamLabel(trick.winnerTeam, viewerSeat)} · ${seatName(trick.winnerSeat)}`;
      case 'tie':
        return 'Emparde';
      case 'hidden':
        return 'Cartas de abajo sin revelar';
      case 'incomplete':
        return 'La vuelta no terminó';
      default:
        return 'No se jugó';
    }
  }

  function payment(kind: string) {
    return (
      ({ flor: 'Flor', envido: 'Envido', truco: 'Truco' } as Record<string, string>)[kind] ?? kind
    );
  }
</script>

<div class="hand-recap" aria-label={`Resultado explicado de la mano ${recap.handNumber}`}>
  <p class="recap-explanation">{explanation}</p>
  {#if recap.winner >= 0 && !['forfeit', 'privo_declined', 'privo_flor', 'flor_presented', 'truco_declined'].includes(recap.reason)}
    <p><strong>Ganó las cartas: {teamLabel(recap.winner, viewerSeat)}.</strong></p>
  {:else if recap.winner >= 0 && recap.reason !== 'forfeit'}
    <p><strong>Ganó la mano: {teamLabel(recap.winner, viewerSeat)}.</strong></p>
  {/if}
  {#if recap.matchWinner >= 0}
    <p class="match-winner">
      <strong>Ganó la partida: {teamLabel(recap.matchWinner, viewerSeat)}.</strong>
    </p>
  {/if}

  <section aria-label="Cambio del marcador">
    <h3>Así cambió el marcador</h3>
    <dl class="recap-scores">
      {#each [0, 1] as team (team)}
        <div>
          <dt>{teamLabel(team, viewerSeat)}</dt>
          <dd>
            {recap.scoresBefore[team]} → {recap.scoresAfter[team]}
            <span>(+{recap.scoresAfter[team] - recap.scoresBefore[team]})</span>
          </dd>
        </div>
      {/each}
    </dl>
    {#if recap.payouts.length}
      <h4>Pagos, en el orden aplicado</h4>
      <ol class="recap-payments">
        {#each recap.payouts as payout, index (index)}
          <li>
            <span>{payment(payout.kind)} · {teamLabel(payout.team, viewerSeat)}</span>
            <strong>+{payout.points} {payout.points === 1 ? 'piedra' : 'piedras'}</strong>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="muted">No se añadieron piedras en este cierre.</p>
    {/if}
    {#if recap.matchWinner >= 0 && recap.reason !== 'forfeit'}
      <p class="muted">
        La partida terminó al alcanzar el objetivo de {recap.target} piedras. No se sumaron pagos posteriores.
      </p>
    {/if}
  </section>

  <section aria-label="Resultado de las vueltas">
    <h3>Qué pasó con las cartas</h3>
    <p class="recap-mano">
      Era mano: {seatName(recap.mano)} · {teamLabel(recap.mano % 2, viewerSeat)}.
    </p>
    {#if recap.vira}
      <div class="recap-vira">
        <Card card={recap.vira} width={44} intro={false} />
        <p>
          Vira de esta mano: <strong>{cardName(recap.vira)}.</strong>
        </p>
      </div>
    {/if}
    <ol class="recap-tricks">
      {#each recap.tricks as trick (trick.round)}
        <li class="recap-trick">
          <div class="trick-heading">
            <h4>{trick.round + 1}.ª vuelta</h4>
            <span>{outcome(trick)}</span>
          </div>
          {#if trick.status !== 'unplayed'}
            <ul class="recap-plays">
              {#each trick.plays as play (play.seat)}
                <li>
                  <span class="play-name">{seatName(play.seat)}</span>
                  {#if play.present && play.card && !play.burned && !play.concealed}
                    <Card card={play.card} width={44} intro={false} />
                    <span>{cardName(play.card)}</span>
                  {:else}
                    {#if play.present}<Card hidden width={44} intro={false} />{/if}
                    <span>
                      {!play.present ? 'Sin jugar' : play.burned ? 'Quemada' : 'Sin revelar'}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  </section>

  {#if recap.envidoResults.length}
    <section aria-label="Tantos revelados al cierre">
      <h3>Tantos revelados al cierre</h3>
      <ul class="envido-totals">
        {#each recap.envidoResults as result (result.seat)}
          <li>
            <span>{seatName(result.seat)}</span>
            <strong>{result.eligible ? result.value : 'Flor inválida'}</strong>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if cantos.length}
    <section aria-label="Cantos y respuestas de esta mano">
      <h3>Cantos y respuestas</h3>
      <ol class="recap-cantos">
        {#each cantos as item (item.id)}
          <li>
            <strong>
              {item.event.seat >= 0
                ? seatName(item.event.seat)
                : teamLabel(item.event.team ?? 0, viewerSeat)}
            </strong>
            <span>{eventLabel(item.event)}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</div>

<style>
  .hand-recap {
    display: grid;
    gap: 20px;
    min-width: 0;
    color: var(--foreground);
  }
  p {
    margin: 0;
    line-height: 1.6;
  }
  .recap-explanation {
    font-size: 16px;
  }
  .match-winner {
    color: var(--primary);
  }
  section {
    min-width: 0;
  }
  section + section {
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 750;
  }
  h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .recap-scores {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 0 0 16px;
  }
  .recap-scores > div {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--background);
  }
  dt {
    color: var(--muted-foreground);
    font-size: 14px;
  }
  dd {
    margin: 4px 0 0;
    font-size: 22px;
    font-weight: 750;
  }
  dd span {
    font-size: 14px;
    font-weight: 650;
    white-space: nowrap;
  }
  ol,
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recap-payments {
    display: grid;
    gap: 8px;
    margin: 10px 0;
  }
  .recap-payments li,
  .envido-totals li {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .recap-payments strong {
    white-space: nowrap;
  }
  .recap-tricks {
    display: grid;
    gap: 12px;
  }
  .recap-vira {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 14px;
  }
  .recap-mano {
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--muted-foreground);
  }
  .recap-trick {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
  }
  .trick-heading {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .trick-heading > span {
    font-size: 14px;
    color: var(--muted-foreground);
  }
  .recap-plays {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding-top: 12px;
  }
  .recap-plays li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    text-align: center;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .play-name {
    font-weight: 700;
  }
  .envido-totals {
    display: grid;
    gap: 8px;
  }
  .recap-cantos {
    display: grid;
    gap: 10px;
  }
  .recap-cantos li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 14px;
  }
  .recap-cantos span {
    color: var(--muted-foreground);
  }
  @media (min-width: 540px) {
    .recap-plays {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 360px) {
    .recap-scores {
      grid-template-columns: 1fr;
    }
  }
</style>
