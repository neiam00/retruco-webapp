<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.js';
  import { teamLabel } from '#lib/team-labels.js';
  import type { HistoryEntry, Statistics } from '#lib/protocol.js';

  let {
    history,
    statistics,
    statisticsError,
    onretry,
  }: {
    history: HistoryEntry[];
    statistics: Statistics | null;
    statisticsError: string;
    onretry: () => void;
  } = $props();
  let filter = $state<'all' | 'human' | 'cpu'>('all');
  let performance = $derived(
    statistics && (filter === 'all' ? statistics.overall : statistics[filter]),
  );
  let visible = $derived(
    history.filter((entry) => {
      const cpu = entry.hasCPU ?? entry.players?.some((player) => player.cpu) ?? false;
      return filter === 'all' || (filter === 'cpu' ? cpu : !cpu);
    }),
  );
  let partners = $derived(
    (statistics?.partners ?? [])
      .map((partner) => ({
        ...partner,
        games: filter === 'all' ? partner.human.games + partner.cpu.games : partner[filter].games,
        wins: filter === 'all' ? partner.human.wins + partner.cpu.wins : partner[filter].wins,
      }))
      .filter((partner) => partner.games > 0)
      .toSorted((a, b) => b.games - a.games || a.name.localeCompare(b.name, 'es')),
  );
</script>

<div class="history-filters" aria-label="Tipo de partidas">
  {#each [{ value: 'all', label: 'Todas' }, { value: 'human', label: 'Sin CPU' }, { value: 'cpu', label: 'Con CPU' }] as option (option.value)}
    <Button
      variant={filter === option.value ? 'secondary' : 'outline'}
      aria-pressed={filter === option.value}
      onclick={() => (filter = option.value as typeof filter)}
    >
      {option.label}
    </Button>
  {/each}
</div>
{#if performance}
  <section aria-label="Estadísticas de toda tu historia">
    <p class="muted text-sm">Toda tu historia · Solo partidas terminadas con ganador</p>
    <dl class="statistics-grid">
      <div>
        <dt>Partidas</dt>
        <dd>{performance.games}</dd>
      </div>
      <div>
        <dt>Victorias</dt>
        <dd>{performance.wins}</dd>
      </div>
      <div>
        <dt>Derrotas</dt>
        <dd>{performance.losses}</dd>
      </div>
      <div>
        <dt>Victorias %</dt>
        <dd>{performance.games ? performance.winRate + '%' : '—'}</dd>
      </div>
    </dl>
  </section>
{/if}
{#if statisticsError}
  <div role="alert">
    <p class="error">{statisticsError}</p>
    <Button variant="outline" onclick={onretry}>Reintentar estadísticas</Button>
  </div>
{/if}
{#if partners.length}
  <details class="partner-summary">
    <summary>Resultados con tus compañeros</summary>
    <ul>
      {#each partners as partner (partner.id)}
        <li>
          <strong>{partner.name}</strong>
          <span>
            {partner.games} partidas · {partner.wins} victorias · {Math.round(
              (partner.wins / partner.games) * 100,
            )}%
          </span>
        </li>
      {/each}
    </ul>
  </details>
{/if}
<h3>Partidas recientes</h3>
<p class="muted text-sm">
  Las últimas 50 partidas. Las estadísticas incluyen también las anteriores.
</p>
{#each visible as entry (entry.code)}
  <article class="history-row">
    <div class="row spread">
      <strong>
        {entry.roomCode ?? entry.code}{entry.gameNumber && entry.gameNumber > 1
          ? ` · Partida ${entry.gameNumber}`
          : ''}
      </strong>
      <span class="muted text-sm">
        {(entry.hasCPU ?? entry.players?.some((player) => player.cpu)) ? 'Con CPU' : 'Sin CPU'}
      </span>
    </div>
    <p class="muted">
      {#if entry.expired}Mesa abandonada · {entry.scores[0]} — {entry.scores[1]}
      {:else}{entry.scores[0]} — {entry.scores[1]} · {entry.finished
          ? 'Terminada'
          : 'En curso'}{/if}
    </p>
    <time class="muted text-sm" datetime={entry.updatedAt}>
      {new Date(entry.updatedAt).toLocaleString('es-VE', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}
    </time>
    {#if entry.team >= 0}<p>Jugaste en el equipo {entry.team + 1} · Nosotros</p>{/if}
    {#if entry.finished && !entry.expired && entry.winner >= 0}
      <p class="history-result">
        Ganador: {teamLabel(entry.winner, entry.team ?? -1)} · Equipo {entry.winner + 1}
      </p>
    {/if}
    <details>
      <summary>Detalles de la partida</summary>
      {#if entry.config?.players}
        <p class="muted text-sm">
          {entry.config.players === 2 ? '1 vs 1' : '2 vs 2'} · {entry.config.target} piedras · {entry
            .config.florRequired
            ? 'Flor por derecho'
            : 'Flor libre'}{entry.hands ? ` · ${entry.hands} manos` : ''}
        </p>
      {/if}
      <div class="history-teams">
        {#each [0, 1] as team (team)}
          <div>
            <strong>{teamLabel(team, entry.team ?? -1)} · Equipo {team + 1}</strong>
            <ul>
              {#each (entry.players ?? []).filter((player) => player.team === team) as player (player.seat)}
                <li>
                  {player.name}
                  <span class="muted">· Puesto {player.seat + 1}{player.cpu ? ' · CPU' : ''}</span>
                </li>
              {:else}<li class="muted">Sin jugadores registrados</li>{/each}
            </ul>
          </div>
        {/each}
      </div>
    </details>
    {#if !entry.finished && !entry.expired}
      <Button
        href={resolve('/mesa/[code]', { code: entry.roomCode ?? entry.code })}
        variant="outline"
      >
        Volver
      </Button>
    {/if}
  </article>
{:else}
  <p>
    {history.length
      ? 'No hay partidas recientes de este tipo.'
      : 'Todavía no hay partidas. La primera te espera.'}
  </p>
{/each}

<style>
  .history-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .statistics-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 12px 0;
  }
  .statistics-grid > div {
    background: var(--background, #101312);
    border: 1px solid var(--border, #354039);
    border-radius: 9px;
    padding: 10px;
  }
  dt {
    font-size: 12px;
    color: var(--muted-foreground, #a6b0a9);
  }
  dd {
    margin: 0;
    font-size: 24px;
    font-weight: 750;
  }
  .history-row {
    border-top: 1px solid var(--border, #354039);
    padding: 16px 0;
  }
  .history-row p {
    margin: 4px 0;
  }
  .history-result {
    font-weight: 700;
  }
  .history-teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding-top: 8px;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    padding: 4px 0;
    overflow-wrap: anywhere;
  }
  summary {
    min-height: 44px;
    align-content: center;
    cursor: pointer;
    font-weight: 650;
  }
  .partner-summary li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
  }
  .partner-summary span {
    color: var(--muted-foreground, #a6b0a9);
  }
  @media (max-width: 420px) {
    .statistics-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .history-teams {
      grid-template-columns: 1fr;
    }
  }
</style>
