import { cardURL } from './cards.js';
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

function position(element: HTMLElement): CardPosition {
  const bounds = element.getBoundingClientRect();
  let angle = 0;
  // Include the hand fan and the table lane's rotation, not just the image.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const transform = getComputedStyle(parent).transform;
    if (transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform);
      angle += (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    }
  }
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
    width: element.offsetWidth,
    height: element.offsetHeight,
    angle,
  };
}

/** Presentation only: confirmed snapshots always update immediately. */
export class CardMotion {
  private active = new Set<() => void>();
  private generation = 0;
  private dealEnds = 0;

  cancel() {
    this.generation++;
    for (const finish of this.active) finish();
    this.dealEnds = 0;
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
      after.phase === 'hand_over' ||
      after.phase === 'match_over' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.hidden
    ) {
      this.cancel();
      return () => {};
    }

    const flights: Flight[] = [];
    const image = (selector: string) => root.querySelector<HTMLElement>(`${selector} img`);
    const dealing = before.phase === 'cutting' && after.phase === 'playing';
    if (dealing) {
      this.cancel();
      const deck = image('[data-deck]');
      if (!deck) return () => {};
      const from = position(deck);
      const counts = Array<number>(next.config.players).fill(0);
      const deal = (seat: number) => {
        const index = counts[seat]++;
        flights.push({
          from,
          target:
            seat === perspective
              ? `[data-hand-card="${index}"] img`
              : `[data-seat="${seat}"] [data-card-back="${index}"] img`,
          delay: flights.length * 75,
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
      this.dealEnds = performance.now() + flights.at(-1)!.delay + 360;
    } else {
      for (const [seatIndex, seat] of after.seats.entries()) {
        const newlyUsed = after.hand.filter(
          (held) => held.used && !before.hand.find((old) => old.index === held.index)?.used,
        );
        for (const [round, play] of seat.plays.entries()) {
          if (!play.present || before.seats[seatIndex]?.plays[round]?.present) continue;
          const held =
            newlyUsed.find(
              (held) =>
                held.card.suit === play.card?.suit && held.card.number === play.card?.number,
            ) ??
            newlyUsed.find(
              (held) =>
                !seat.plays.some(
                  (other) =>
                    other.card?.suit === held.card.suit && other.card?.number === held.card.number,
                ),
            );
          const source =
            seatIndex === perspective && held
              ? image(`[data-hand-card="${held.index}"]`)
              : image(`[data-seat="${seatIndex}"] [data-card-back]`);
          if (!source) continue;
          flights.push({
            from: position(source),
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
      for (const flight of flights) this.fly(root, flight);
    };
  }

  private fly(root: HTMLElement, flight: Flight) {
    const target = root.querySelector<HTMLImageElement>(flight.target);
    if (!target) return;
    const to = position(target);
    if (!to.width || !to.height) return;
    const card = document.createElement('img');
    // Only the confirmed public target supplies a face. Concealed/burned cards
    // and opponents' deals use the back even when this viewer knows their hand.
    card.src = flight.dealing ? cardURL() : target.src;
    card.alt = '';
    card.setAttribute('aria-hidden', 'true');
    card.dataset.cardFlight = flight.dealing ? 'deal' : 'play';
    Object.assign(card.style, {
      position: 'fixed',
      left: `${to.x - to.width / 2}px`,
      top: `${to.y - to.height / 2}px`,
      width: `${to.width}px`,
      height: `${to.height}px`,
      maxWidth: 'none',
      borderRadius: '5%',
      background: '#fffdf2',
      boxShadow: '0 12px 18px #041a1655',
      pointerEvents: 'none',
      zIndex: '30',
    });
    const visibility = target.style.visibility;
    target.style.visibility = 'hidden';
    document.body.append(card);
    const { from } = flight;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const animation = card.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) rotate(${from.angle}deg) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 0,
          offset: 0,
        },
        {
          transform: `translate(${dx}px, ${dy}px) rotate(${from.angle}deg) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 1,
          offset: 0.01,
        },
        {
          transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 16}px) rotate(${to.angle - 4}deg) scale(1.06)`,
          opacity: 1,
          offset: 0.65,
        },
        { transform: `rotate(${to.angle}deg)`, opacity: 1, offset: 1 },
      ],
      {
        duration: flight.dealing ? 360 : 420,
        delay: flight.delay,
        easing: 'cubic-bezier(0.22, 0.65, 0.3, 1)',
        fill: 'both',
      },
    );
    const finish = () => {
      target.style.visibility = visibility;
      animation.cancel();
      card.remove();
      this.active.delete(finish);
    };
    this.active.add(finish);
    void animation.finished.then(finish, () => {});
  }
}
