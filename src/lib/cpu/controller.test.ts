import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CPUController } from './controller.js';
import type { CPURequest, CPUWork, GameView } from '#lib/protocol.js';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  messages: { id: string; request: CPURequest }[] = [];
  terminated = false;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(message: { id: string; request: CPURequest }) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  ready() {
    this.onmessage?.({ data: { type: 'ready' } });
  }
  answer(index: number) {
    const { id, request } = this.messages[index];
    this.onmessage?.({
      data: {
        type: 'decision',
        id,
        result: {
          version: request.version,
          seat: request.seat,
          revision: request.view.revision,
          kind: request.kind,
          token: request.token,
          ...(request.memory
            ? { memoryHand: request.memory.hand, memoryCursor: request.memory.total }
            : {}),
          ...(request.kind === 'signal'
            ? { signal: 'none' }
            : { command: { type: 'play', card: 0 } }),
        },
      },
    });
  }
  memory(index: number, cursor: number) {
    const { id, request } = this.messages[index];
    this.onmessage?.({
      data: {
        type: 'memory',
        id,
        request: {
          seat: request.seat,
          token: request.token,
          memoryHand: request.memory?.hand,
          memoryCursor: cursor,
        },
      },
    });
  }
}

// The controller transports views opaquely; rule behavior is tested against the
// real Go engine and in the browser tests, not in this scheduling fixture.
function work(revision: number): CPUWork {
  return { version: 1, controlled: true, seat: 1, view: { revision } as GameView };
}

beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('waits for card presentation and still cancels a waiting move on lease loss', () => {
  const send = vi.fn();
  let moving = true;
  const controller = new CPUController(send, vi.fn(), () => moving);
  controller.update(work(1));
  const worker = TestWorker.instances[0];
  worker.ready();
  worker.answer(0);
  vi.advanceTimersByTime(700);
  expect(send).not.toHaveBeenCalled();
  moving = false;
  vi.advanceTimersByTime(50);
  expect(send).toHaveBeenCalledTimes(1);

  moving = true;
  controller.update(work(2));
  worker.answer(1);
  vi.advanceTimersByTime(700);
  controller.stop();
  moving = false;
  vi.advanceTimersByTime(1000);
  expect(send).toHaveBeenCalledTimes(1);
});

test('ignores obsolete decisions and submits a revision only once despite duplicate snapshots', () => {
  const send = vi.fn();
  const controller = new CPUController(send, vi.fn());
  controller.update(work(1));
  const worker = TestWorker.instances[0];
  worker.ready();
  controller.update(work(2));
  controller.update(work(2));
  expect(TestWorker.instances).toHaveLength(1);
  expect(worker.messages).toHaveLength(2);
  worker.answer(0);
  vi.advanceTimersByTime(1000);
  expect(send).not.toHaveBeenCalled();
  worker.answer(1);
  controller.update(work(2));
  vi.advanceTimersByTime(1000);
  controller.update(work(2));
  expect(send).toHaveBeenCalledExactlyOnceWith(1, 2, { type: 'play', card: 0 });
  expect(worker.messages).toHaveLength(2);
  controller.stop();
});

test('revoking control cancels a delayed move and ignores errors from the old worker', () => {
  const send = vi.fn();
  const controller = new CPUController(send, vi.fn());
  controller.update(work(1));
  const previous = TestWorker.instances[0];
  previous.ready();
  previous.answer(0);
  controller.update({ version: 1, controlled: false, seat: -1 });
  vi.advanceTimersByTime(1000);
  expect(send).not.toHaveBeenCalled();
  expect(previous.terminated).toBe(true);
  controller.update(work(2));
  const current = TestWorker.instances[1];
  previous.onerror?.();
  previous.answer(0);
  expect(current.terminated).toBe(false);
  current.ready();
  current.answer(0);
  vi.advanceTimersByTime(1000);
  expect(send).toHaveBeenCalledExactlyOnceWith(1, 2, { type: 'play', card: 0 });
  controller.stop();
});

test('loading timeout survives revision updates and a retry replaces the failed worker', () => {
  const changed = vi.fn();
  const controller = new CPUController(vi.fn(), changed);
  controller.update(work(1));
  vi.advanceTimersByTime(10000);
  controller.update(work(2));
  vi.advanceTimersByTime(5000);
  expect(changed).toHaveBeenLastCalledWith('error', expect.stringContaining('iniciar'));
  expect(TestWorker.instances[0].terminated).toBe(true);
  controller.retry();
  expect(TestWorker.instances).toHaveLength(2);
  TestWorker.instances[1].ready();
  expect(TestWorker.instances[1].messages[0].request.view.revision).toBe(2);
  controller.stop();
});

test('v2 tokens invalidate decisions even when rules revision is unchanged', () => {
  const send = vi.fn();
  const controller = new CPUController(send, vi.fn());
  const first: CPUWork = { ...work(7), version: 2, kind: 'game', token: 'old' };
  controller.update(first);
  const worker = TestWorker.instances[0];
  worker.ready();
  controller.update({ ...first, token: 'new' });
  worker.answer(0);
  vi.advanceTimersByTime(1000);
  expect(send).not.toHaveBeenCalled();
  worker.answer(1);
  vi.advanceTimersByTime(650);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    1,
    7,
    { type: 'play', card: 0 },
    expect.objectContaining({ token: 'new', kind: 'game' }),
  );
  controller.stop();
});

test('signal none is acknowledged once without delaying for card animation', () => {
  const send = vi.fn();
  const controller = new CPUController(send, vi.fn(), () => true);
  const input: CPUWork = { ...work(7), version: 2, kind: 'signal', token: 'signal-work' };
  controller.update(input);
  const worker = TestWorker.instances[0];
  worker.ready();
  worker.answer(0);
  vi.advanceTimersByTime(1);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    1,
    7,
    undefined,
    expect.objectContaining({ signal: 'none', token: 'signal-work' }),
  );
  controller.update(input);
  expect(worker.messages).toHaveLength(1);
  controller.stop();
});

function recurrentWork(token: string, start: number, end: number, total = 64): CPUWork {
  return {
    ...work(7),
    version: 2,
    kind: 'game',
    token,
    memoryKey: 'match-seat-lease',
    memory: {
      version: 1,
      hand: 1,
      start,
      end,
      total,
      complete: true,
      events: Array.from({ length: end - start }, () => Array(768).fill(0)),
    },
  };
}

test('pages memory without submitting actions and ignores duplicate or stale replay replies', () => {
  const send = vi.fn();
  const requestMemory = vi.fn();
  const changed = vi.fn();
  const controller = new CPUController(send, changed, () => false, requestMemory);
  const first = recurrentWork('page-one', 0, 32);
  controller.update(first);
  const worker = TestWorker.instances[0];
  worker.ready();
  expect(worker.messages[0].request).toMatchObject({
    memoryKey: first.memoryKey,
    memory: first.memory,
  });
  worker.memory(0, 32);
  worker.memory(0, 32);
  controller.update(first);
  expect(requestMemory).toHaveBeenCalledExactlyOnceWith({
    seat: 1,
    token: 'page-one',
    memoryHand: 1,
    memoryCursor: 32,
  });
  expect(send).not.toHaveBeenCalled();
  expect(worker.messages).toHaveLength(1);
  controller.update(recurrentWork('page-two', 32, 64));
  worker.memory(0, 0);
  worker.onmessage?.({ data: { type: 'error', id: 'page-one', error: 'obsolete failure' } });
  expect(worker.terminated).toBe(false);
  expect(requestMemory).toHaveBeenCalledTimes(1);
  worker.answer(1);
  vi.advanceTimersByTime(650);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    1,
    7,
    { type: 'play', card: 0 },
    expect.objectContaining({ token: 'page-two', memoryHand: 1, memoryCursor: 64 }),
  );
  controller.stop();
});

test('worker retry can reset the server cursor and catches up before committing a move', () => {
  const send = vi.fn();
  const requestMemory = vi.fn();
  const controller = new CPUController(send, vi.fn(), () => false, requestMemory);
  controller.update(recurrentWork('old-worker-page', 32, 64));
  const previous = TestWorker.instances[0];
  previous.ready();
  controller.retry();
  const worker = TestWorker.instances[1];
  worker.ready();
  previous.memory(0, 0);
  expect(requestMemory).not.toHaveBeenCalled();
  worker.memory(0, 0);
  expect(requestMemory).toHaveBeenLastCalledWith({
    seat: 1,
    token: 'old-worker-page',
    memoryHand: 1,
    memoryCursor: 0,
  });
  controller.update(recurrentWork('reset-page', 0, 32));
  worker.memory(1, 32);
  controller.update(recurrentWork('caught-up-page', 32, 64));
  worker.answer(2);
  vi.advanceTimersByTime(650);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][3]).toMatchObject({ token: 'caught-up-page', memoryCursor: 64 });
  controller.stop();
});

test('losing the lease cancels replay and a stalled page request still times out', () => {
  const requestMemory = vi.fn();
  const changed = vi.fn();
  const controller = new CPUController(vi.fn(), changed, () => false, requestMemory);
  controller.update(recurrentWork('page', 0, 32));
  const previous = TestWorker.instances[0];
  previous.ready();
  controller.update({ version: 2, controlled: false, seat: -1 });
  previous.memory(0, 32);
  expect(requestMemory).not.toHaveBeenCalled();
  controller.update(recurrentWork('fresh-page', 0, 32));
  const current = TestWorker.instances[1];
  current.ready();
  current.memory(0, 32);
  vi.advanceTimersByTime(5000);
  expect(current.terminated).toBe(true);
  expect(changed).toHaveBeenLastCalledWith('error', expect.stringContaining('responder'));
});

test.each([0, 31, 33, 65, -1, NaN])(
  'rejects a replay cursor not acknowledged by its current page: %s',
  (cursor) => {
    const requestMemory = vi.fn();
    const changed = vi.fn();
    const controller = new CPUController(vi.fn(), changed, () => false, requestMemory);
    controller.update(recurrentWork('page', 0, 32));
    const worker = TestWorker.instances[0];
    worker.ready();
    worker.memory(0, cursor);
    expect(requestMemory).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(changed).toHaveBeenLastCalledWith('error', expect.stringContaining('sincronizar'));
  },
);

test('rejects action acknowledgement before its last journal page arrives', () => {
  const send = vi.fn();
  const controller = new CPUController(send, vi.fn(), () => false, vi.fn());
  controller.update(recurrentWork('incomplete-page', 0, 32));
  const worker = TestWorker.instances[0];
  worker.ready();
  worker.answer(0);
  vi.advanceTimersByTime(650);
  expect(send).not.toHaveBeenCalled();
  expect(worker.terminated).toBe(true);
});
