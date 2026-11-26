import { eventLabel } from '#lib/game-events.js';
import type { Card, GameEvent, GameView, Snapshot } from '#lib/protocol.js';

export interface DealSlot {
  seat: number;
  index: number;
  previewer?: number;
}

export interface Placement {
  seat: number;
  round: number;
  heldIndex?: number;
  card?: Card;
  burned: boolean;
  concealed: boolean;
}

export type TableAction =
  | { type: 'shuffle'; seat: number }
  | { type: 'deal'; cutter: number; dealer: number; slots: DealSlot[] }
  | { type: 'play'; seat: number; cards: Placement[] }
  | { type: 'reveal'; cards: Placement[] }
  | { type: 'canto'; seat: number; clip: 'bid' | 'accept' | 'decline'; label: string }
  | { type: 'signal'; seat: number; kind: string }
  | { type: 'result'; winner: number };

export function viewSeat(snapshot: Snapshot) {
  return snapshot.seat < 0 ? snapshot.perspective : snapshot.seat;
}

export function sceneIdentity(snapshot: Snapshot) {
  return `${snapshot.code}:${snapshot.gameNumber ?? 1}:${snapshot.seat}:${snapshot.perspective}`;
}

export function dealOrder(players: number, dealer: number) {
  const first = (dealer + players - 1) % players;
  const counts = Array<number>(players).fill(0);
  const slots: DealSlot[] = [];
  const next = (seat: number, previewer?: number) =>
    slots.push({ seat, index: counts[seat]++, ...(previewer === undefined ? {} : { previewer }) });
  if (players === 4) {
    next((first + 2) % 4, first);
    next((dealer + 2) % 4, dealer);
  }
  for (let seat = first; slots.length < players * 3; seat = (seat + 1) % players) {
    if (counts[seat] < 3) next(seat);
  }
  return slots;
}

export function peekFace(snapshot: Snapshot, slot: DealSlot) {
  if (slot.previewer === viewSeat(snapshot)) return snapshot.state?.preview;
}

export function dealtFace(snapshot: Snapshot, slot: DealSlot) {
  if (slot.seat === viewSeat(snapshot)) {
    return snapshot.state?.hand.find(({ index }) => index === slot.index)?.card;
  }
}

export function visualChanges(previous: Snapshot, next: Snapshot): TableAction[] {
  const before = previous.state;
  const after = next.state;
  if (!before || !after || sceneIdentity(previous) !== sceneIdentity(next)) return [];
  if (before.handNumber !== after.handNumber) {
    return after.phase === 'cutting' ? [{ type: 'shuffle', seat: after.dealer }] : [];
  }

  const actions: TableAction[] = [];
  if (!before.vira && after.vira) {
    actions.push({
      type: 'deal',
      cutter: before.turn,
      dealer: after.dealer,
      slots: dealOrder(next.config.players, after.dealer),
    });
  }

  const due = after.seats.map((): Placement[] => []);
  const flips: Placement[] = [];
  const newlyUsed = after.hand.filter(
    (card) => card.used && !before.hand.some((old) => old.index === card.index && old.used),
  );
  for (const player of after.seats) {
    for (const [round, play] of player.plays.entries()) {
      if (!play.present) continue;
      const old = before.seats[player.seat]?.plays[round];
      const placement: Placement = { seat: player.seat, round, ...play };
      if (!old?.present) {
        if (player.seat === viewSeat(next)) {
          const matchesFace = newlyUsed.findIndex(({ card }) => sameCard(card, play.card));
          const index =
            matchesFace >= 0
              ? matchesFace
              : newlyUsed.findIndex(
                  ({ card }) => !player.plays.some(({ card: face }) => sameCard(card, face)),
                );
          if (index >= 0) placement.heldIndex = newlyUsed.splice(index, 1)[0].index;
        }
        due[player.seat].push(placement);
      } else if (
        old.burned !== play.burned ||
        old.concealed !== play.concealed ||
        !sameCard(old.card, play.card)
      ) {
        flips.push(placement);
      }
    }
  }
  const eventID = previous.events?.at(-1)?.id ?? -1;
  const signalID = previous.signals.at(-1)?.id ?? -1;
  const timeline = [
    ...(next.events ?? [])
      .filter(({ hand, id }) => hand === after.handNumber && id > eventID)
      .map(({ id, event }) => ({ id, event })),
    ...next.signals
      .filter(({ id }) => id > signalID)
      .map(({ id, seat, kind }) => ({ id, signal: { seat, kind } })),
  ].sort((a, b) => a.id - b.id);

  for (const item of timeline) {
    if ('signal' in item) {
      actions.push({ type: 'signal', ...item.signal });
      continue;
    }
    const event = item.event;
    if (event.seat < 0 || event.seat >= after.seats.length) continue;
    const label = eventLabel(event);
    if (label && !event.automatic) {
      const clip =
        event.type !== 'respond' || !['accept', 'decline'].includes(event.kind ?? '')
          ? 'bid'
          : event.kind === 'decline'
            ? 'decline'
            : 'accept';
      actions.push({ type: 'canto', seat: event.seat, clip, label });
    }
    if (['play', 'burn', 'stack', 'timeout'].includes(event.type) && due[event.seat].length) {
      const pair = event.type === 'stack' || (before.mandatoryStack && event.type !== 'play');
      actions.push({
        type: 'play',
        seat: event.seat,
        cards: due[event.seat].splice(0, pair ? 2 : 1),
      });
    }
  }
  for (const [seat, cards] of due.entries()) {
    if (cards.length) actions.push({ type: 'play', seat, cards });
  }
  if (flips.length) actions.push({ type: 'reveal', cards: flips });
  if (
    before.phase !== after.phase &&
    (after.phase === 'hand_over' || after.phase === 'match_over')
  ) {
    actions.push({ type: 'result', winner: after.winner >= 0 ? after.winner : after.handWinner });
  }
  return actions;
}

function sameCard(first?: Card, second?: Card) {
  return first?.suit === second?.suit && first?.number === second?.number;
}

export function lessonSnapshot(view: GameView, events: GameEvent[] = []): Snapshot {
  return {
    code: 'practice',
    private: true,
    config: view.config,
    seats: [
      { id: 'learner', name: 'Tú' },
      { id: 'practice-cpu', name: 'CPU de práctica', cpu: true },
    ],
    seat: 0,
    perspective: 0,
    state: view,
    deadline: '',
    serverTime: '',
    sequence: view.revision,
    chat: [],
    signals: [],
    events,
  };
}
