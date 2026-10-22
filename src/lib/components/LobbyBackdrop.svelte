<script lang="ts">
  import { onMount } from 'svelte';
  import { cardURL } from '#lib/cards.js';
  import type { Card } from '#lib/protocol.js';

  let { paused = false }: { paused?: boolean } = $props();
  let hidden = $state(false);
  let cards = $state.raw<
    { card: Card; left: number; width: number; duration: number; delay: number; angle: number }[]
  >([]);

  onMount(() => {
    hidden = document.hidden;
    const suits: Card['suit'][] = ['coins', 'cups', 'spades', 'clubs'];
    const numbers = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
    const deck = suits.flatMap((suit) => numbers.map((number) => ({ suit, number })));
    for (let index = deck.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [deck[index], deck[other]] = [deck[other], deck[index]];
    }
    // Choose once per visit. CSS moves a bounded set of cached WebP images;
    // there is no frame loop, repeated decoding, or reactive animation state.
    cards = deck.slice(0, 8).map((card, index) => {
      const duration = 30 + Math.random() * 18;
      return {
        card,
        left: 3 + index * 13,
        width: 64 + Math.random() * 28,
        duration,
        delay: -Math.random() * duration,
        angle: -25 + Math.random() * 50,
      };
    });
  });
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<div class={['lobby-backdrop', { paused: paused || hidden }]} aria-hidden="true">
  {#each cards as item (item.left)}
    <img
      src={cardURL(item.card)}
      alt=""
      width="80"
      height="123"
      decoding="async"
      draggable="false"
      style:left={`${item.left}%`}
      style:width={`${item.width}px`}
      style:--duration={`${item.duration}s`}
      style:--delay={`${item.delay}s`}
      style:--angle={`${item.angle}deg`}
    />
  {/each}
</div>

<style>
  .lobby-backdrop {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    contain: strict;
  }
  img {
    position: absolute;
    top: -180px;
    height: auto;
    border-radius: 4px;
    opacity: 0.13;
    animation: fall var(--duration) var(--delay) linear infinite;
  }
  .paused img {
    animation-play-state: paused;
  }
  @keyframes fall {
    from {
      transform: translate3d(-20px, 0, 0) rotate(var(--angle));
    }
    to {
      transform: translate3d(20px, calc(100svh + 360px), 0) rotate(calc(var(--angle) + 40deg));
    }
  }
  @media (max-width: 760px) {
    img:nth-child(even) {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    img {
      animation: none;
      display: none;
    }
  }
</style>
