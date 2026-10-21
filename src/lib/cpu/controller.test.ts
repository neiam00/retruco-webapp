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
          command: { type: 'play', card: 0 },
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
