import { deckImageURLs } from './cards.js';

/** Warm the public deck once per room, without delaying snapshots or gameplay. */
export function preloadDeck(): () => void {
  const urls = deckImageURLs();
  const images = new Set<HTMLImageElement>();
  let next = 0;
  let stopped = false;

  async function loadCards() {
    while (!stopped && next < urls.length) {
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = 'low';
      images.add(image);
      image.src = urls[next++];
      try {
        await image.decode();
      } catch {
        // A failed warmup must not block the rest of the deck. Visible cards
        // and animations can retry their normal image load when needed.
        images.delete(image);
      }
      // Give input, rendering and CPU messages a turn between decoded images.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // Avoid a burst of 41 simultaneous downloads and decodes on slower devices.
  void loadCards();
  void loadCards();

  return () => {
    stopped = true;
    // Keep decoded images alive while the room is open, then release them and
    // cancel pending loads. The HTTP cache remains available for future rooms.
    for (const image of images) image.removeAttribute('src');
    images.clear();
  };
}
