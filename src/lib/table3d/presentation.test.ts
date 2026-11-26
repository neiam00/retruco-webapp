import { expect, it } from 'vitest';
import type { Card, GameView, Snapshot } from '#lib/protocol.js';
import { dealOrder, dealtFace, peekFace, visualChanges } from './presentation.js';

it('stages the two partner passes before the regular deal and reveals each card only in its permitted view', () => {
  const preview: Card = { suit: 'cups', number: 7 };
  const handCard: Card = { suit: 'clubs', number: 10 };
  const config = { players: 4, target: 12, florRequired: true };
  const playing: GameView = {
    config,
    version: '2',
    revision: 2,
    phase: 'playing',
    handNumber: 1,
    dealer: 0,
    mano: 1,
    turn: 1,
    round: 0,
    vira: { suit: 'coins', number: 11 },
    scores: [0, 0],
    winner: -1,
    handWinner: -1,
    trucoValue: 1,
    mandatoryStack: false,
    seats: Array.from({ length: 4 }, (_, seat) => ({
      seat,
      team: seat % 2,
      remaining: 3,
      plays: [],
    })),
    hand: [{ index: 0, card: handCard, used: false }],
    preview,
    florValid: false,
    legal: [],
    payouts: [],
  };
  const after: Snapshot = {
    code: 'PREV-1234',
    private: true,
    config,
    seat: 0,
    perspective: 0,
    state: playing,
    seats: Array.from({ length: 4 }, (_, seat) => ({ id: String(seat), name: `Player ${seat}` })),
    sequence: 2,
    serverTime: '',
    deadline: '',
    chat: [],
    signals: [],
    events: [],
  };
  const before: Snapshot = {
    ...after,
    sequence: 1,
    state: {
      ...playing,
      revision: 1,
      phase: 'cutting',
      turn: 3,
      vira: undefined,
      hand: [],
      preview: undefined,
    },
  };
  const deal = visualChanges(before, after)[0];
  expect(deal).toMatchObject({ type: 'deal', cutter: 3, dealer: 0 });
  if (deal?.type !== 'deal') throw new Error('Missing deal action');
  expect(deal.slots).toEqual([
    { seat: 1, index: 0, previewer: 3 },
    { seat: 2, index: 0, previewer: 0 },
    { seat: 3, index: 0 },
    { seat: 0, index: 0 },
    { seat: 1, index: 1 },
    { seat: 2, index: 1 },
    { seat: 3, index: 1 },
    { seat: 0, index: 1 },
    { seat: 1, index: 2 },
    { seat: 2, index: 2 },
    { seat: 3, index: 2 },
    { seat: 0, index: 2 },
  ]);
  const first = deal.slots[0];
  const second = deal.slots[1];
  const cutter = { ...after, seat: 3, perspective: 3 };
  const dealer = { ...after, seat: 0, perspective: 0 };
  const recipient = { ...after, seat: 1, perspective: 1 };
  expect(peekFace(cutter, first)).toEqual(preview);
  expect(peekFace(dealer, first)).toBeUndefined();
  expect(peekFace(dealer, second)).toEqual(preview);
  expect(peekFace(recipient, first)).toBeUndefined();
  expect(dealtFace(cutter, first)).toBeUndefined();
  expect(dealtFace(recipient, first)).toEqual(handCard);
  expect(dealOrder(2, 0)).toEqual([
    { seat: 1, index: 0 },
    { seat: 0, index: 0 },
    { seat: 1, index: 1 },
    { seat: 0, index: 1 },
    { seat: 1, index: 2 },
    { seat: 0, index: 2 },
  ]);
});
