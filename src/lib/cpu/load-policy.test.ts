import { afterEach, expect, test, vi } from 'vitest';
import { loadPolicy } from './load-policy.js';

afterEach(() => vi.unstubAllGlobals());

test('disabled inference never downloads models or runtimes', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await loadPolicy(false, '/cpu/manifest.json')).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([false, 'false', 'true', 1, {}, null, undefined])(
  'a checkpoint without literal approval (%j) downloads no binary assets',
  async (approved) => {
    vi.stubGlobal('location', { origin: 'https://retruco.test' });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ approved }) });
    vi.stubGlobal('fetch', fetch);
    expect(await loadPolicy(true, '/cpu/manifest.json')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test('network failure and cross-origin configuration return the local fallback', async () => {
  vi.stubGlobal('location', { origin: 'https://retruco.test' });
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  expect(await loadPolicy(true, 'https://elsewhere.test/manifest.json')).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  expect(await loadPolicy(true, '/cpu/manifest.json')).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
