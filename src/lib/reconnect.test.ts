import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReconnectBackoff } from './reconnect.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('keeps retries within room grace before applying longer backoff capped at thirty seconds', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const reconnect = new ReconnectBackoff();
  const connect = vi.fn();
  for (const delay of [1000, 2000, 2000, 2000, 2000, 2000, 30000, 30000]) {
    reconnect.schedule(connect);
    vi.advanceTimersByTime(delay - 1);
    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledOnce();
    connect.mockClear();
  }
});

test('jitters early retries instead of synchronizing every client', () => {
  const random = vi.spyOn(Math, 'random');
  const first = vi.fn();
  const second = vi.fn();
  random.mockReturnValueOnce(0).mockReturnValueOnce(0.999999);
  new ReconnectBackoff().schedule(first);
  new ReconnectBackoff().schedule(second);
  vi.advanceTimersByTime(500);
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(second).toHaveBeenCalledOnce();
});

test('rapid reconnect failures retain backoff while stable sessions reset it', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const reconnect = new ReconnectBackoff();
  const connect = vi.fn();
  reconnect.schedule(connect);
  vi.advanceTimersByTime(500);
  reconnect.connected();
  vi.advanceTimersByTime(100);
  reconnect.schedule(connect);
  connect.mockClear();
  vi.advanceTimersByTime(999);
  expect(connect).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(connect).toHaveBeenCalledOnce();
  reconnect.connected();
  vi.advanceTimersByTime(10_000);
  reconnect.schedule(connect);
  connect.mockClear();
  vi.advanceTimersByTime(500);
  expect(connect).toHaveBeenCalledOnce();
});

test('honors server retry delays and cancels queued work when offline or unmounted', () => {
  const reconnect = new ReconnectBackoff();
  const connect = vi.fn();
  reconnect.schedule(connect, 60_000);
  vi.advanceTimersByTime(59_999);
  expect(connect).not.toHaveBeenCalled();
  reconnect.cancel();
  vi.advanceTimersByTime(60_000);
  expect(connect).not.toHaveBeenCalled();
  reconnect.schedule(connect, 5_000);
  vi.advanceTimersByTime(5_000);
  expect(connect).toHaveBeenCalledOnce();
});
