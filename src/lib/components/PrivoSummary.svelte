<script lang="ts">
  import { teamLabel } from '#lib/team-labels.js';
  import type { GameView } from '#lib/protocol.js';

  let { game, viewerSeat }: { game: GameView; viewerSeat: number } = $props();
</script>

{#if game.privoEnvido?.length}
  <section class="privo-summary" aria-label="Equipos privando" aria-live="polite">
    {#each game.privoEnvido as announced (announced.team)}
      <div class="privo-team">
        <strong>{teamLabel(announced.team, viewerSeat)} · Privando</strong>
        <span>{announced.value} de envido</span>
      </div>
    {/each}
    <details class={{ inactive: game.phase !== 'playing' }} inert={game.phase !== 'playing'}>
      <summary>Envido fijo: 2 piedras · Ver regla</summary>
      <div class="explanation">
        <p>Envido fijo: 2 piedras, sin subidas. Se cuenta antes del truco.</p>
        {#if game.pending?.kind === 'privo'}
          <p>«Privo y Truco» acepta jugar; el truco sigue valiendo 1 hasta que alguien lo cante.</p>
          {#if game.legal.some((command) => command.kind === 'present_flor')}
            <p>
              Puedes presentar tu flor para cerrar la mano con 3 piedras, o jugar y conservarla.
            </p>
          {/if}
        {/if}
      </div>
    </details>
  </section>
{/if}

<style>
  .privo-summary {
    position: relative;
    max-width: 600px;
    margin: 4px auto;
    padding: 6px 12px;
    border: 1px solid #ddd09c70;
    border-radius: 16px;
    background: #16362c;
    color: #f5efda;
    font-size: 11px;
  }
  .privo-team {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }
  .privo-team + .privo-team {
    margin-top: 10px;
  }
  .privo-team span {
    color: #e6d59c;
    font-weight: 750;
  }
  p {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: #bfcebf;
  }
  summary {
    cursor: pointer;
    padding: 4px;
    color: #bfcebf;
  }
  .inactive {
    visibility: hidden;
  }
  .explanation {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    right: 0;
    padding: 12px;
    border: 1px solid #ddd09c70;
    border-radius: 12px;
    background: #16362c;
    z-index: 10;
  }
  @media (max-width: 640px) {
    .privo-summary {
      margin: 4px;
      padding: 6px 10px;
    }
  }
</style>
