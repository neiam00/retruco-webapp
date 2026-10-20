<script lang="ts">
  import type { Card } from '#lib/protocol.js';
  import { cardURL, cardName } from '#lib/cards.js';
  let {
    card,
    width = 80,
    hidden = false,
  }: { card?: Card; width?: number; hidden?: boolean } = $props();
</script>

<img
  class="card-image"
  src={cardURL(hidden ? undefined : card)}
  alt={!hidden && card ? cardName(card) : 'Carta boca abajo'}
  {width}
  height={Math.round((width * 319) / 207)}
  draggable="false"
/>
