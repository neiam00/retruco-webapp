<script lang="ts">
  import { hierarchy } from '#lib/cards.js';
</script>

<p class="muted mb-4">De mayor a menor. La vira define el perico y la perica.</p>
<ol class="hierarchy">
  {#each hierarchy as name, i (name)}
    <li>
      <span>{i + 1}</span>
      {name}
    </li>
  {/each}
</ol>
<p class="muted mt-4 text-sm">
  Perico: 11 del palo de la vira. Perica: 10. Si la vira es 10 u 11, el 12 de su palo sustituye esa
  pieza.
</p>

<style>
  .hierarchy {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px 20px;
    list-style: none;
    padding: 0;
  }
  .hierarchy li {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 0.85rem;
  }
  .hierarchy span {
    display: grid;
    place-items: center;
    background: var(--secondary);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    font-size: 0.7rem;
    flex-shrink: 0;
  }
  @media (max-width: 400px) {
    .hierarchy {
      grid-template-columns: 1fr;
    }
  }
</style>
