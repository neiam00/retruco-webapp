import { afterEach, expect, it, vi } from 'vitest';
import { preloadDeck } from './card-preload.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('continues after a failed image and stops queued loads when the room is left', async () => {
  vi.useFakeTimers();
  const images: PendingImage[] = [];
  class PendingImage {
    src = '';
    decoding = '';
    fetchPriority = '';
    reject!: (error: Error) => void;
    ready = new Promise<void>((_resolve, reject) => {
      this.reject = reject;
    });

    constructor() {
      images.push(this);
    }
    decode() {
      return this.ready;
    }
    removeAttribute(name: string) {
      if (name === 'src') {
        this.src = '';
        this.reject(new Error('Image load cancelled'));
      }
    }
  }
  vi.stubGlobal('Image', PendingImage);
  const stop = preloadDeck();
  expect(images).toHaveLength(2);
  expect(images[0].src).toMatch(/^https:\/\/cards\.example\.test\/cards\/card_back-.*\.webp$/);
  images[0].reject(new Error('Network unavailable'));
  await vi.runAllTimersAsync();
  expect(images).toHaveLength(3);
  expect(images[1].src).not.toBe('');

  stop();
  await vi.runAllTimersAsync();
  expect(images).toHaveLength(3);
  expect(images[1].src).toBe('');
  expect(images[2].src).toBe('');
});
