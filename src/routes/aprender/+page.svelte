<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import { ArrowLeft, ArrowRight, BookOpen, RotateCcw, CircleHelp } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import Card from '#lib/components/Card.svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';
  import HandRecap from '#lib/components/HandRecap.svelte';
  import { api } from '#lib/api.js';
  import { cardName } from '#lib/cards.js';
  import {
    tutorialCopy,
    isTutorialLesson,
    hasLessonCommand,
    type TutorialLesson,
  } from '#lib/tutorial.js';

  let lesson = $state.raw<TutorialLesson | null>(null);
  let index = $state(0);
  let loading = $state(true);
  let error = $state('');
  let feedback = $state('');
  let whyOpen = $state(false);
  let attempt = 0;
  let disposed = false;
  let step = $derived(lesson?.steps[index]);
  let copy = $derived(step ? tutorialCopy[step.id] : null);
  let choosingCard = $derived(
    step?.id === 'pieces' || step?.id === 'first-card' || step?.id === 'perico',
  );
  let rounds = $derived(
    [0, 1, 2].filter((round) => step?.view.seats.some((seat) => seat.plays[round]?.present)),
  );
  let finished = $derived(step?.id === 'recap');

  async function load() {
    const request = ++attempt;
    loading = true;
    error = '';
    try {
      const latest = await api<unknown>('/tutorial');
      if (!isTutorialLesson(latest))
        throw new Error(
          'Esta práctica necesita una versión actualizada. Recarga la página e inténtalo de nuevo.',
        );
      if (disposed || request !== attempt) return;
      lesson = latest;
      index = 0;
      feedback = '';
      whyOpen = false;
    } catch (cause) {
      if (!disposed && request === attempt)
        error =
          cause instanceof Error
            ? cause.message
            : 'No pudimos preparar la práctica. Inténtalo de nuevo.';
    } finally {
      if (!disposed && request === attempt) loading = false;
    }
  }

  onMount(() => {
    void load();
    return () => {
      disposed = true;
    };
  });

  function move(next: number) {
    if (!lesson || next < 0 || next >= lesson.steps.length) return;
    index = next;
    feedback = '';
    whyOpen = false;
    void tick().then(() => document.getElementById('lesson-title')?.focus());
  }

  function chooseCard(card: number) {
    if (!step || !choosingCard) return;
    const expected = step.id === 'pieces' ? 0 : (step.command?.card ?? 0);
    if (card !== expected) {
      feedback =
        step.id === 'pieces'
          ? 'Busca el 11 del palo de la vira: en esta mano es el 11 de oros.'
          : step.id === 'first-card'
            ? 'Esa carta también sería válida. Para seguir esta práctica, guarda el perico y juega el 7 de copas.'
            : 'Para resolver esta práctica, juega el perico: el 11 de oros.';
      return;
    }
    if (step.id !== 'pieces' && !hasLessonCommand(step)) {
      feedback = 'No pudimos preparar esa jugada. Reinicia la práctica para intentarlo de nuevo.';
      return;
    }
    move(index + 1);
  }

  function advance() {
    if (!step) return;
    if (step.command && !hasLessonCommand(step)) {
      feedback = 'No pudimos preparar ese canto. Reinicia la práctica para intentarlo de nuevo.';
      return;
    }
    move(index + 1);
  }
</script>

{#snippet learnerHand()}
  {#if step}
    <div class="learner-hand" aria-label="Tu mano de práctica">
      <div class="hand-heading">
        <strong>Tus cartas</strong>
        {#if index >= 2 && step.view.holding}<span>
            Envido: {step.view.holding.envido}
          </span>{/if}
      </div>
      <div class="lesson-cards">
        {#each step.view.hand as item (item.index)}
          <div class={['lesson-card', { used: item.used }]}>
            <button
              type="button"
              class="card-choice"
              disabled={!choosingCard || item.used}
              aria-label={`${choosingCard && !item.used ? 'Elegir ' : ''}${cardName(item.card)}${item.used ? ', ya jugada' : ''}`}
              onclick={() => chooseCard(item.index)}
            >
              <Card card={item.card} width={88} intro={false} />
            </button>
            <span>{cardName(item.card)}{item.used ? ' · Jugada' : ''}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

<svelte:head>
  <title>Aprender jugando — Retruco</title>
  <meta
    name="description"
    content="Juega tu primera mano de truco venezolano paso a paso. Aprende la vira, perico, perica, envido y truco, sin reloj ni cuenta."
  />
</svelte:head>

<main class="page-shell lesson-shell">
  <header class="masthead">
    <a href={resolve('/')} class="brand" aria-label="Retruco, inicio">
      <span class="brand-mark">r.</span>
      retruco
    </a>
    <Button href={resolve('/')} variant="outline"><ArrowLeft />Volver a las mesas</Button>
  </header>
  <div class="lesson-intro">
    <h1>Tu primera mano</h1>
    <p class="muted">
      Una mano preparada con la CPU, paso a paso. Sin reloj ni cuenta. Esta práctica no cuenta en tu
      historial.
    </p>
  </div>

  {#if loading}
    <section class="lesson-state" aria-label="Preparando práctica">
      <p role="status">Preparando tu primera mano…</p>
    </section>
  {:else if error}
    <section class="lesson-state">
      <p class="error" role="alert">{error}</p>
      <Button onclick={() => void load()}>Volver a intentar</Button>
    </section>
  {:else if lesson && step && copy}
    <div class="lesson-layout">
      <section class="lesson-coach" aria-labelledby="lesson-title">
        <div class="lesson-progress">
          <span>Paso {index + 1} de {lesson.steps.length}</span>
          <progress
            max={lesson.steps.length}
            value={index + 1}
            aria-label="Progreso de la práctica"
          ></progress>
        </div>
        <h2 id="lesson-title" tabindex="-1">{copy.title}</h2>
        <p>{copy.body}</p>
        <Button
          variant="ghost"
          class="why-button"
          aria-expanded={whyOpen}
          aria-controls="lesson-why"
          onclick={() => (whyOpen = !whyOpen)}
        >
          <CircleHelp />¿Por qué?
        </Button>
        {#if whyOpen}<div
            id="lesson-why"
            class="lesson-why"
            role="region"
            aria-label="Explicación de este paso"
          >
            <p>{copy.why}</p>
          </div>{/if}
        {#if feedback}<p class="lesson-feedback" role="status">{feedback}</p>{/if}
        {#if finished}
          <div class="lesson-total" aria-label="Piedras ganadas">
            {#each step.view.payouts as payout, payoutIndex (`${payout.kind}-${payout.team}-${payoutIndex}`)}
              <p>{payout.team === 0 ? 'Tú' : 'CPU'}: +{payout.points} de {payout.kind}</p>
            {/each}
            <strong>Marcador: {step.view.scores[0]} — {step.view.scores[1]}</strong>
          </div>
          {#if step.view.lastHand}
            <details class="lesson-recap">
              <summary>Ver el resultado explicado</summary>
              <HandRecap
                recap={step.view.lastHand}
                seats={[{ name: 'Tú' }, { name: 'CPU de práctica' }]}
                viewerSeat={0}
                events={step.events}
              />
            </details>
          {/if}
          <Button href={resolve('/')} class="lesson-primary">Ir a las mesas<ArrowRight /></Button>
          <Button variant="outline" onclick={() => move(0)}><RotateCcw />Repetir práctica</Button>
        {:else if !choosingCard}
          <Button class="lesson-primary" onclick={advance}>
            {copy.action ?? 'Continuar'}<ArrowRight />
          </Button>
        {:else}
          <p class="card-instruction">Elige una carta de tu mano para continuar.</p>
          <div class="mobile-choice-hand">{@render learnerHand()}</div>
        {/if}
        <div class="lesson-navigation">
          <Button variant="ghost" disabled={index === 0} onclick={() => move(index - 1)}>
            <ArrowLeft />Anterior
          </Button>
          {#if !finished}<Button variant="ghost" disabled={index === 0} onclick={() => move(0)}>
              <RotateCcw />Reiniciar
            </Button>{/if}
        </div>
      </section>

      <section class="practice-table" aria-label="Mesa de práctica">
        <div class="practice-score" aria-label="Marcador de práctica">
          <span>
            Tú <strong>{step.view.scores[0]}</strong>
          </span>
          <span>
            CPU <strong>{step.view.scores[1]}</strong>
          </span>
        </div>
        <div class="opponent-seat">
          <PlayerAvatar name="CPU de práctica" size={36} />
          <span>CPU de práctica</span>
          <div
            class="opponent-hand"
            aria-label={`${step.view.seats[1].remaining} cartas sin jugar de la CPU`}
          >
            {#each Array.from({ length: step.view.seats[1].remaining }, (_, card) => card) as card (card)}<Card
                hidden
                width={27}
                intro={false}
              />{/each}
          </div>
        </div>
        <div class={['lesson-vira', { highlighted: step.id === 'vira' || step.id === 'pieces' }]}>
          <Card card={step.view.vira} width={70} intro={false} />
          <strong>La vira</strong>
        </div>
        {#if rounds.length}
          <div class="played-tricks" aria-label="Vueltas jugadas">
            {#each rounds as round (round)}
              <div class="played-trick">
                <h3>{round + 1}.ª vuelta</h3>
                <div class="trick-cards">
                  {#each step.view.seats as seat (seat.seat)}<div>
                      <span>{seat.seat === 0 ? 'Tú' : 'CPU'}</span>
                      {#if seat.plays[round]?.present}<Card
                          card={seat.plays[round].card}
                          hidden={!seat.plays[round].card}
                          width={56}
                          intro={false}
                        />{:else}<span class="unplayed">Sin jugar</span>{/if}
                    </div>{/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}<p class="table-empty">Las cartas jugadas aparecerán aquí.</p>{/if}
        <div class={['board-hand', { 'choice-active': choosingCard }]}>{@render learnerHand()}</div>
      </section>
    </div>
    <footer class="lesson-footer">
      <p>Esta mano enseña lo básico. Flor, empardes y pegado también forman parte del juego.</p>
      <Button href={resolve('/reglas')} variant="ghost">
        <BookOpen />Consultar las reglas completas
      </Button>
    </footer>
  {/if}
</main>

<style>
  .lesson-shell {
    max-width: 1160px;
  }
  .lesson-intro {
    padding: 22px 0 28px;
  }
  h1 {
    font-size: clamp(28px, 4vw, 36px);
    margin-bottom: 8px;
  }
  .lesson-intro p {
    max-width: 700px;
    line-height: 1.65;
  }
  .lesson-layout {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
    align-items: start;
    gap: 24px;
  }
  .lesson-coach,
  .lesson-state {
    padding: 26px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
  }
  .lesson-state {
    display: grid;
    justify-items: start;
    gap: 16px;
  }
  .lesson-progress {
    display: grid;
    gap: 8px;
    color: var(--muted-foreground);
    font-size: 13px;
    margin-bottom: 24px;
  }
  progress {
    appearance: none;
    width: 100%;
    height: 5px;
    border: 0;
    background: var(--secondary);
    border-radius: 4px;
    overflow: hidden;
  }
  progress::-webkit-progress-bar {
    background: var(--secondary);
  }
  progress::-webkit-progress-value {
    background: var(--primary);
  }
  progress::-moz-progress-bar {
    background: var(--primary);
  }
  h2 {
    font-size: 25px;
    line-height: 1.25;
    margin-bottom: 16px;
  }
  .lesson-coach > p {
    line-height: 1.7;
    color: var(--muted-foreground);
  }
  .lesson-coach :global(.why-button) {
    margin: 10px 0;
    padding-left: 0;
  }
  .lesson-why {
    border-left: 3px solid var(--primary);
    padding-left: 14px;
    margin-bottom: 18px;
    color: var(--muted-foreground);
    line-height: 1.7;
  }
  .lesson-coach .lesson-feedback {
    color: var(--foreground);
    background: var(--secondary);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .lesson-coach :global(.lesson-primary) {
    margin: 8px 0 12px;
  }
  .lesson-coach .card-instruction {
    color: var(--primary);
    font-weight: 650;
  }
  .lesson-navigation {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    margin-top: 20px;
  }
  .lesson-total {
    display: grid;
    gap: 5px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 12px;
  }
  .lesson-total strong {
    margin-top: 6px;
    font-size: 20px;
  }
  .lesson-recap {
    margin: 12px 0;
  }
  .lesson-recap summary {
    min-height: 44px;
    align-content: center;
    cursor: pointer;
    font-weight: 650;
  }
  .practice-table {
    padding: 22px;
    border: 1px solid #496957;
    border-radius: 20px;
    background: #15392c;
    color: #edf0ec;
    min-width: 0;
  }
  .practice-score {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    border-bottom: 1px solid #bad9c230;
    padding-bottom: 10px;
  }
  .practice-score span {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #d0dbd2;
  }
  .practice-score strong {
    color: #edf0ec;
    font-size: 25px;
  }
  .opponent-seat {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin: 18px 0;
    font-weight: 650;
  }
  .opponent-hand {
    display: flex;
    gap: 3px;
    margin-left: 8px;
  }
  .lesson-vira {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    width: fit-content;
    margin: 14px auto 20px;
    padding: 10px 14px;
    border: 2px solid transparent;
    border-radius: 12px;
    color: #d0dbd2;
  }
  .lesson-vira.highlighted {
    border-color: #bad9c2;
  }
  .table-empty {
    padding: 28px 8px;
    text-align: center;
    color: #c0cfc4;
    font-size: 14px;
  }
  .played-tricks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(115px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .played-trick {
    border: 1px solid #bad9c230;
    border-radius: 10px;
    padding: 10px;
  }
  .played-trick h3 {
    font-size: 13px;
    margin-bottom: 8px;
    text-align: center;
  }
  .trick-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .trick-cards > div {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 5px;
    min-width: 0;
    font-size: 12px;
  }
  .trick-cards :global(img) {
    max-width: 100%;
    height: auto;
  }
  .unplayed {
    min-height: 70px;
    display: grid;
    align-content: center;
    color: #c0cfc4;
  }
  .learner-hand {
    padding-top: 16px;
    border-top: 1px solid #bad9c230;
  }
  .hand-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    font-size: 14px;
  }
  .hand-heading span {
    color: #d0dbd2;
  }
  .lesson-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .lesson-card {
    display: grid;
    justify-items: center;
    gap: 8px;
    min-width: 0;
  }
  .lesson-card > span {
    font-size: 12px;
    text-align: center;
    color: #d0dbd2;
  }
  .mobile-choice-hand {
    display: none;
  }
  .card-choice {
    width: 98px;
    max-width: 100%;
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 3px;
    background: transparent;
    min-width: 44px;
    min-height: 44px;
    cursor: pointer;
  }
  .card-choice:not(:disabled) {
    border-color: #bad9c2;
    background: #bad9c212;
  }
  .card-choice:not(:disabled):hover {
    background: #bad9c230;
  }
  .card-choice:disabled {
    cursor: default;
  }
  .card-choice :global(img) {
    display: block;
    width: min(88px, 100%);
    height: auto;
  }
  .lesson-card.used .card-choice {
    opacity: 0.55;
  }
  .lesson-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 24px 0;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  @media (max-width: 760px) {
    .mobile-choice-hand {
      display: block;
      margin-top: 16px;
    }
    .board-hand.choice-active {
      display: none;
    }
    .lesson-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
    .lesson-coach {
      padding: 22px;
    }
    .practice-table {
      padding: 18px;
    }
    .lesson-intro {
      padding-top: 16px;
    }
    .masthead {
      flex-wrap: wrap;
      gap: 12px;
    }
  }
  @media (max-width: 380px) {
    .practice-table {
      padding: 14px;
    }
    .lesson-cards {
      gap: 6px;
    }
    .opponent-seat {
      gap: 7px;
      font-size: 14px;
    }
    .opponent-hand {
      margin-left: 0;
    }
  }
</style>
