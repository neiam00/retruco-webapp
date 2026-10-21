import { cardURL } from './cards.js';
import { DEAL_DURATION_MS, DEAL_INTERVAL_MS, PLAY_DURATION_MS } from './card-timing.js';
import type { Snapshot } from './protocol.js';

interface CardPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

interface Flight {
  from: CardPosition;
  target: string;
  delay: number;
  dealing: boolean;
}

function position(element: HTMLElement, angles: Map<HTMLElement, number>): CardPosition {
  const bounds = element.getBoundingClientRect();
  const angle = ancestorAngle(element.parentElement, angles);
  return {
    x: bounds.left + window.scrollX + bounds.width / 2,
    y: bounds.top + window.scrollY + bounds.height / 2,
    width: element.offsetWidth,
    height: element.offsetHeight,
    angle,
  };
}

function ancestorAngle(element: HTMLElement | null, cache: Map<HTMLElement, number>): number {
  if (!element) return 0;
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const transform = getComputedStyle(element).transform;
  let angle = ancestorAngle(element.parentElement, cache);
  if (transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(transform);
    angle += (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  }
  cache.set(element, angle);
  return angle;
}

/** Presentation only: confirmed snapshots always update immediately. */
export class CardMotion {
  private active = new Set<() => void>();
  private generation = 0;
  private dealEnds = 0;
  private layer?: HTMLDivElement;

  constructor(private readonly changed: (moving: boolean) => void = () => {}) {}

  get moving() {
    return this.active.size > 0;
  }

  cancel() {
    this.generation++;
    for (const finish of this.active) finish();
    this.dealEnds = 0;
    this.layer?.remove();
    this.layer = undefined;
  }

  /** Capture the old hand before Svelte renders the next snapshot. */
  prepare(root: HTMLElement, previous: Snapshot | null, next: Snapshot): () => void {
    const before = previous?.state;
    const after = next.state;
    const perspective = next.seat < 0 ? next.perspective : next.seat;
    if (
      !before ||
      !after ||
      previous?.seat !== next.seat ||
      previous?.perspective !== next.perspective ||
      before.handNumber !== after.handNumber ||
      after.phase === 'cutting' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.hidden
    ) {
      this.cancel();
      return () => {};
    }

    const flights: Flight[] = [];
    const angles = new Map<HTMLElement, number>();
    const image = (selector: string) => root.querySelector<HTMLElement>(`${selector} img`);
    // Privando with flor can decide the match in the deal itself. Show the
    // actual deal before revealing its result, but never animate an undealt exit.
    const dealing = before.phase === 'cutting' && after.vira !== undefined;
    if (dealing) {
      this.cancel();
      const deck = image('[data-deck]');
      if (!deck) return () => {};
      const from = position(deck, angles);
      const counts = Array<number>(next.config.players).fill(0);
      const deal = (seat: number) => {
        const index = counts[seat]++;
        flights.push({
          from,
          target:
            seat === perspective
              ? `[data-hand-card="${index}"] img`
              : `[data-seat="${seat}"] [data-card-back="${index}"] img`,
          delay: flights.length * DEAL_INTERVAL_MS,
          dealing: true,
        });
      };
      // Match the engine's two partner-preview cards, then its round-robin deal.
      const left = (after.dealer + next.config.players - 1) % next.config.players;
      if (next.config.players === 4) {
        deal((left + 2) % 4);
        deal((after.dealer + 2) % 4);
      }
      for (
        let seat = left;
        flights.length < next.config.players * 3;
        seat = (seat + 1) % next.config.players
      ) {
        if (counts[seat] < 3) deal(seat);
      }
      this.dealEnds = performance.now() + flights.at(-1)!.delay + DEAL_DURATION_MS;
    } else {
      const newlyUsed = after.hand.filter(
        (held) => held.used && !before.hand.find((old) => old.index === held.index)?.used,
      );
      for (const [seatIndex, seat] of after.seats.entries()) {
        const remainingSources = [...newlyUsed];
        for (const [round, play] of seat.plays.entries()) {
          if (!play.present || before.seats[seatIndex]?.plays[round]?.present) continue;
          const held =
            remainingSources.find(
              (held) =>
                held.card.suit === play.card?.suit && held.card.number === play.card?.number,
            ) ??
            remainingSources.find(
              (held) =>
                !seat.plays.some(
                  (other) =>
                    other.card?.suit === held.card.suit && other.card?.number === held.card.number,
                ),
            );
          // Two concealed burns still leave from two different hand cards.
          if (held) remainingSources.splice(remainingSources.indexOf(held), 1);
          const source =
            seatIndex === perspective && held
              ? image(`[data-hand-card="${held.index}"]`)
              : image(`[data-seat="${seatIndex}"] [data-card-back]`);
          if (!source) continue;
          flights.push({
            from: position(source, angles),
            target: `[data-play-seat="${seatIndex}"][data-play-round="${round}"] img`,
            delay: Math.max(0, this.dealEnds - performance.now()),
            dealing: false,
          });
        }
      }
    }
    const generation = this.generation;
    return () => {
      if (generation !== this.generation) return;
      if (flights.length) this.render(root, flights);
    };
  }

  private render(root: HTMLElement, flights: Flight[]) {
    const pending = flights.flatMap((flight) => {
      const target = root.querySelector<HTMLImageElement>(flight.target);
      if (!target) return [];
      const card = new Image();
      // Never copy a private source face onto a concealed public target.
      card.src = flight.dealing ? cardURL() : target.currentSrc || target.src;
      card.alt = '';
      card.setAttribute('aria-hidden', 'true');
      card.dataset.cardFlight = flight.dealing ? 'deal' : 'play';
      const visibility = target.style.visibility;
      let animation: Animation | undefined;
      let finished = false;
      let stopWaiting = () => {};
      const stopped = new Promise<null>((resolve) => {
        stopWaiting = () => resolve(null);
      });
      const finish = () => {
        if (finished) return;
        finished = true;
        stopWaiting();
        clearTimeout(timeout);
        target.style.visibility = visibility;
        animation?.cancel();
        card.remove();
        this.active.delete(finish);
        this.changed(this.moving);
      };
      // A broken image request must not leave cards hidden or stall CPU control.
      const timeout = setTimeout(finish, 3000 + flight.delay);
      this.active.add(finish);
      target.style.visibility = 'hidden';
      return [
        {
          flight,
          target,
          card,
          finish,
          stopped,
          alive: () => !finished && target.isConnected,
          start: (value: Animation) => {
            clearTimeout(timeout);
            animation = value;
          },
        },
      ];
    });
    if (!pending.length) return;
    this.changed(true);

    // Decode before starting the clock: on a cold connection, an animation can
    // otherwise finish before Safari has any card pixels available to display.
    void Promise.all(
      pending.map((item) =>
        Promise.race([
          Promise.all([item.card.decode(), item.target.decode()]).then(
            () => item,
            () => {
              item.finish();
              return null;
            },
          ),
          // A cancelled or timed-out image must not hold up the other cards.
          item.stopped,
        ]),
      ),
    ).then((decoded) => {
      const ready = decoded
        .filter((item) => {
          if (!item) return false;
          if (item.alive()) return true;
          item.finish();
          return false;
        })
        .filter((item) => item !== null);
      if (!root.isConnected || !ready.length) return;
      const angles = new Map<HTMLElement, number>();
      const bounds = root.getBoundingClientRect();
      const origin = { x: bounds.left + window.scrollX, y: bounds.top + window.scrollY };
      // Finish every layout read before writing styles or appending any images.
      const measured = ready.map((item) => ({ item, to: position(item.target, angles) }));
      const layer = this.getLayer(root);
      const fragment = document.createDocumentFragment();
      for (const { item, to } of measured) {
        if (!to.width || !to.height) {
          item.finish();
          continue;
        }
        Object.assign(item.card.style, {
          position: 'absolute',
          left: `${to.x - origin.x - to.width / 2}px`,
          top: `${to.y - origin.y - to.height / 2}px`,
          width: `${to.width}px`,
          height: `${to.height}px`,
          maxWidth: 'none',
          borderRadius: '5%',
          background: '#fffdf2',
          boxShadow: '0 8px 12px #041a1640',
          willChange: 'transform, opacity',
          transform: `rotate(${to.angle}deg)`,
        });
        fragment.append(item.card);
      }
      layer.append(fragment);
      const started = performance.now();
      for (const { item, to } of measured) {
        if (!item.alive() || !item.card.isConnected) continue;
        const delay = item.flight.dealing
          ? item.flight.delay
          : Math.max(0, this.dealEnds - started);
        if (item.flight.dealing)
          this.dealEnds = Math.max(this.dealEnds, started + delay + DEAL_DURATION_MS);
        const animation = item.card.animate(this.keyframes(item.flight, to), {
          duration: item.flight.dealing ? DEAL_DURATION_MS : PLAY_DURATION_MS,
          delay,
          easing: 'cubic-bezier(0.22, 0.65, 0.3, 1)',
          fill: 'both',
        });
        item.start(animation);
        void animation.finished.then(item.finish, item.finish);
      }
    });
  }

  private getLayer(root: HTMLElement) {
    if (!this.layer?.isConnected) {
      this.layer = document.createElement('div');
      this.layer.setAttribute('aria-hidden', 'true');
      Object.assign(this.layer.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        pointerEvents: 'none',
        zIndex: '8',
      });
      root.append(this.layer);
    }
    return this.layer;
  }

  private keyframes(flight: Flight, to: CardPosition): Keyframe[] {
    const { from } = flight;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    return [
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${from.angle}deg) scale(${from.width / to.width}, ${from.height / to.height})`,
        opacity: 0,
        offset: 0,
      },
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${from.angle}deg) scale(${from.width / to.width}, ${from.height / to.height})`,
        opacity: 1,
        offset: 0.01,
      },
      {
        transform: `translate3d(${dx * 0.35}px, ${dy * 0.35 - 16}px, 0) rotate(${to.angle - 4}deg) scale(1.06)`,
        opacity: 1,
        offset: 0.65,
      },
      { transform: `rotate(${to.angle}deg)`, opacity: 1, offset: 1 },
    ];
  }
}
