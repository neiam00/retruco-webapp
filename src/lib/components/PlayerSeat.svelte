<script lang="ts">
  import { Layers } from '@lucide/svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';

  let {
    name,
    team,
    remaining = 3,
    active = false,
    answering = false,
    self = false,
    mano = false,
    announcement = '',
  }: {
    name: string;
    team: number;
    remaining?: number;
    active?: boolean;
    answering?: boolean;
    self?: boolean;
    mano?: boolean;
    announcement?: string;
  } = $props();
</script>

<div class={['player-seat', { active, answering }]}>
  <PlayerAvatar {name} size={38} />
  <div class="identity">
    <strong>{name}{self ? ' · Tú' : ''}</strong>
    <span>
      <Layers size={12} />{remaining}
      <i></i>
      Equipo {team}
    </span>
  </div>
  {#if active || answering || mano}
    <span class="seat-tag">{answering ? 'RESPONDE' : active ? 'TURNO' : 'MANO'}</span>
  {/if}
  {#if announcement}
    <span class="speech-bubble" aria-live="polite">{announcement}</span>
  {/if}
</div>

<style>
  .player-seat {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 158px;
    padding: 11px 14px;
    border: 1px solid #aac2b839;
    border-radius: 16px;
    color: #f3f2e9;
    background: #172725e8;
    box-shadow:
      0 8px 24px #071b1630,
      inset 0 0 0 4px #ffffff03;
  }
  .active,
  .answering {
    border-color: #dfca7e;
    box-shadow:
      0 0 0 4px #dfca7e0a,
      0 8px 24px #071b1630;
  }
  .identity strong {
    display: block;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .identity > span {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    color: #a6b8ae;
    font-size: 10px;
  }
  i {
    width: 3px;
    height: 3px;
    margin: 0 3px;
    border-radius: 50%;
    background: currentColor;
  }
  .seat-tag {
    position: absolute;
    right: -12px;
    top: -12px;
    padding: 5px 8px;
    border-radius: 5px;
    color: #27352c;
    background: #e7d797;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.08em;
    transform: rotate(6deg);
  }
  .speech-bubble {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    max-width: 190px;
    padding: 7px 10px;
    border-radius: 10px 10px 10px 2px;
    color: #20372b;
    background: #e9e2bd;
    box-shadow: 0 4px 12px #061b1533;
    font-size: 10px;
    line-height: 1.3;
    font-weight: 600;
  }
  @media (max-width: 650px) {
    .player-seat {
      min-width: 100px;
      padding: 8px;
      gap: 6px;
      border-radius: 12px;
    }
    .identity strong {
      font-size: 10px;
      max-width: 80px;
    }
    .identity > span {
      font-size: 8px;
      gap: 3px;
    }
    .player-seat :global(.avatar) {
      width: 28px;
      height: 28px;
    }
    .seat-tag {
      font-size: 7px;
      right: 0;
      top: -13px;
    }
  }
</style>
