import { expect, test } from 'vitest';
import { FramePacer } from './frame-pacer.js';

test.each([60, 90, 120])('draws at 60 fps with a %d Hz refresh and small jitter', (refreshRate) => {
  const clock = new FramePacer();
  const intervals = [];
  for (let frame = 0; frame <= refreshRate; frame++) {
    const jitter = frame === 0 ? 0 : Math.sin(frame * 2.1) * 1.15;
    const interval = clock.drawTime((frame * 1000) / refreshRate + jitter);
    if (interval !== undefined) intervals.push(interval);
  }
  expect(intervals).toHaveLength(61);
  expect(intervals.slice(1).reduce((sum, interval) => sum + interval, 0)).toBeCloseTo(1, 2);
});

test('resumes on the first requested draw and bounds animation time after a stall', () => {
  const clock = new FramePacer();
  expect(clock.drawTime(0)).toBeCloseTo(1 / 60, 5);
  expect(clock.drawTime(8.3)).toBeUndefined();
  expect(clock.drawTime(240)).toBe(0.1);
  expect(clock.drawTime(248.3)).toBeUndefined();
  clock.reset();
  expect(clock.drawTime(256.6)).toBeCloseTo(1 / 60, 5);
});
