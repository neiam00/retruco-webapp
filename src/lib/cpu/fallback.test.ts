import { describe, expect, it } from 'vitest';
import type { CPURequest, CPUResponse } from '#lib/protocol.js';
import corpus from './testdata/native-policy.json';
import { fallback } from './fallback.js';
import publicWin from './testdata/public-winning-truco.json';

describe('native Go policy parity', () => {
  it('matches every generated native decision across complete seeded matches', () => {
    const cases = corpus as unknown as { request: CPURequest; want: CPUResponse }[];
    expect(cases.length).toBeGreaterThan(100);
    expect(new Set(cases.map((c) => c.request.view.config.players))).toEqual(new Set([2, 4]));
    expect(new Set(cases.map((c) => c.request.view.config.target))).toEqual(new Set([12, 24]));
    expect(cases.some((c) => c.request.view.pending)).toBe(true);
    for (const { request, want } of cases) expect(fallback(request)).toEqual(want);
  });
});

it('accepts an all-in when the teammate has publicly secured the hand', () => {
  const request = { version: 1, seat: 0, entropy: 0, view: publicWin } as unknown as CPURequest;
  expect(fallback(request).command?.kind).toBe('accept');
  const hidden = structuredClone(request);
  hidden.view.seats[2].plays[1].concealed = true;
  hidden.view.seats[2].plays[1].card = undefined;
  expect(fallback(hidden).command?.kind).toBe('decline');
});
