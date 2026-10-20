<script lang="ts">
  import { eventLabel } from '#lib/game-events.js';
  import { teamLabel } from '#lib/team-labels.js';
  import type { GameEvent } from '#lib/protocol.js';

  let { events = [], viewerSeat }: { events?: GameEvent[]; viewerSeat: number } = $props();

  let hands = $derived.by(() => {
    const grouped: Record<number, { id: number; label: string; team: number }[]> = {};
    for (const item of events) {
      const label = eventLabel(item.event);
      if (!label) continue;
      const entries = grouped[item.hand] ?? [];
      entries.push({ id: item.id, label, team: (item.event.seat % 2) + 1 });
      grouped[item.hand] = entries;
    }
    return Object.entries(grouped)
      .map(([number, entries]) => ({ number: Number(number), entries }))
      .sort((first, second) => second.number - first.number);
  });
</script>

<section class="canto-history" aria-label="Historial de cantos">
  <header>
    <h2>Cantos de la partida</h2>
    <p>Lo que se dijo, mano a mano.</p>
  </header>
  <!-- Keyboard users need to focus this scrollable history. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="history-scroll" tabindex="0" role="region" aria-label="Cantos por mano">
    {#if !hands.length}
      <p class="empty">Todavía no hay cantos.</p>
    {/if}
    {#each hands as hand (hand.number)}
      <section class="history-hand" aria-label={`Cantos de la mano ${hand.number}`}>
        <h3>Mano {hand.number}</h3>
        <ol>
          {#each hand.entries as entry (entry.id)}
            <li>
              <span class={['team', { 'team-two': entry.team === 2 }]}>
                {teamLabel(entry.team - 1, viewerSeat)}
              </span>
              <span class="canto-label">{entry.label}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  </div>
</section>

<style>
  .canto-history {
    border: 1px solid #a9c1ac30;
    border-radius: 14px;
    background: #10291fe6;
    text-align: left;
    overflow: hidden;
  }
  header {
    padding: 16px;
    border-bottom: 1px solid #a9c1ac20;
  }
  h2 {
    color: #e6dfb9;
    font-size: 13px;
    font-weight: 600;
  }
  header p,
  .empty {
    color: #a7bfaa;
    font-size: 11px;
    line-height: 1.5;
  }
  header p {
    margin-top: 4px;
  }
  .history-scroll {
    max-height: min(440px, 55dvh);
    overflow-y: auto;
    padding: 16px;
    scrollbar-width: thin;
    scrollbar-color: #799581 #10291f;
  }
  .history-hand + .history-hand {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #a9c1ac20;
  }
  h3 {
    margin-bottom: 12px;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #a7bfaa;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 12px;
  }
  li {
    display: grid;
    gap: 4px;
  }
  .team {
    font-size: 10px;
    color: #e1cf90;
  }
  .team-two {
    color: #a7d4c3;
  }
  .canto-label {
    font-size: 12px;
    line-height: 1.4;
    color: #f1f0e6;
    overflow-wrap: anywhere;
  }
</style>
