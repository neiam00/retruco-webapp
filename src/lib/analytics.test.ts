import { afterEach, expect, it, vi } from 'vitest';
import { trackPage } from './analytics.js';

afterEach(() => vi.unstubAllGlobals());

it('queues standard gtag commands without private match codes or automatic pageviews', () => {
  const append = vi.fn();
  vi.stubGlobal('window', { location: { origin: 'https://cards.example.test' } });
  vi.stubGlobal('document', {
    title: 'Mesa ABCD-1234 — Retruco',
    createElement: () => ({ async: false, src: '' }),
    head: { append },
  });

  trackPage('/mesa/ABCD-1234');
  document.title = 'Reglas — Retruco';
  trackPage('/reglas');

  const queue = window.dataLayer ?? [];
  expect(queue.length).toBeGreaterThan(0);
  expect(
    queue.every((entry) => Object.prototype.toString.call(entry) === '[object Arguments]'),
  ).toBe(true);
  const commands = queue.map((entry) => Array.from(entry as ArrayLike<unknown>));
  expect(commands.find((entry) => entry[0] === 'config')?.[2]).toMatchObject({
    send_page_view: false,
  });
  expect(commands.filter((entry) => entry[0] === 'event').map((entry) => entry[2])).toEqual([
    {
      page_location: 'https://cards.example.test/mesa',
      page_referrer: '',
      page_title: 'Mesa — Retruco',
    },
    {
      page_location: 'https://cards.example.test/reglas',
      page_referrer: '',
      page_title: 'Reglas — Retruco',
    },
  ]);
  expect(JSON.stringify(commands)).not.toContain('ABCD-1234');
  expect(append).toHaveBeenCalledTimes(1);
});
