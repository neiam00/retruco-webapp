<script lang="ts">
  import type { Card } from '#lib/protocol.js';
  import { cardURL, cardName } from '#lib/cards.js';
  let {
    card,
    width = 80,
    hidden = false,
  }: { card?: Card; width?: number; hidden?: boolean } = $props();

  function flip(node: Element) {
    const reducedMotion =
      node.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ??
      true;
    return {
      duration: reducedMotion ? 0 : 180,
      css: (progress: number) =>
        `opacity: ${0.4 + progress * 0.6}; transform: perspective(500px) rotateY(${(1 - progress) * -85}deg)`,
    };
  }
</script>

{#key hidden || !card ? 'back' : `${card.suit}-${card.number}`}
  <img
    class="card-image"
    src={cardURL(hidden ? undefined : card)}
    alt={!hidden && card ? cardName(card) : 'Carta boca abajo'}
    {width}
    height={Math.round((width * 319) / 207)}
    draggable="false"
    in:flip
  />
{/key}
