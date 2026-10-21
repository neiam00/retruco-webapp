<script lang="ts">
  import type { Snapshot } from '#lib/protocol.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';

  let {
    snapshot,
    disabled = false,
    onselect,
  }: {
    snapshot: Snapshot;
    disabled?: boolean;
    onselect: (seat: number) => void;
  } = $props();
</script>

<section class="seat-selector" aria-labelledby="seat-selector-title">
  <h2 id="seat-selector-title">Elige tu puesto</h2>
  <p>Elige con quién jugar. La partida comienza cuando se ocupan todos los puestos.</p>
  <div class="teams">
    {#each [0, 1] as team (team)}
      <section class="team" aria-label={`Equipo ${team + 1}`}>
        <h3>Equipo {team + 1}</h3>
        {#each Array.from({ length: snapshot.config.players }, (_, seat) => seat).filter((seat) => seat % 2 === team) as seat (seat)}
          {@const player = snapshot.seats[seat]}
          <div class="seat">
            <div class="row">
              {#if player?.id}<PlayerAvatar name={player.name} />{/if}
              <div>
                <strong>{player?.id ? player.name : 'Puesto libre'}</strong>
                <small>Puesto {seat + 1}{player?.cpu ? ' · CPU' : ''}</small>
              </div>
            </div>
            {#if !player?.id}
              <Button
                {disabled}
                aria-label={`Elegir puesto ${seat + 1}, equipo ${team + 1}`}
                onclick={() => onselect(seat)}
              >
                Sentarme aquí
              </Button>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
</section>

<style>
  .seat-selector {
    margin: 20px;
    padding: 24px;
    border: 1px solid #e8e4ce30;
    border-radius: 20px;
    background: #17372d;
    color: #f4efe3;
  }
  h2 {
    font-size: 1.5rem;
  }
  p {
    margin: 8px 0 20px;
    color: #c5d1bf;
  }
  .teams {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .team {
    padding: 16px;
    border-radius: 14px;
    background: #ffffff08;
    min-width: 0;
  }
  h3 {
    font-size: 1.1rem;
    margin-bottom: 16px;
  }
  .seat {
    display: grid;
    gap: 12px;
    padding: 12px 0;
  }
  strong {
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: #c5d1bf;
    margin-top: 4px;
  }
  @media (max-width: 600px) {
    .seat-selector {
      margin: 12px;
      padding: 16px;
    }
    .teams {
      grid-template-columns: 1fr;
    }
  }
</style>
