import type { Page } from '@playwright/test';
import type { Command, Snapshot } from '../../src/lib/protocol.js';

export function tableSnapshot(players: number, dealer: number, spectator: boolean): Snapshot {
  const config = { players, target: 24, florRequired: true };
  return {
    code: 'VIRA-1234',
    private: true,
    config,
    seats: Array.from({ length: players }, (_, seat) => ({
      id: `player-${seat}`,
      name: seat === 0 ? 'Un nombre bastante largo' : `CPU ${seat}`,
      cpu: seat !== 0,
    })),
    seat: spectator ? -1 : 0,
    perspective: spectator ? players - 1 : 0,
    sequence: 1,
    chat: [],
    signals: [],
    events: Array.from({ length: players }, (_, seat) => ({
      id: seat + 1,
      hand: 1,
      event: { type: 'respond', seat, kind: 'decline' },
    })),
    cantoHistory: [],
    serverTime: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    state: {
      config,
      version: '2',
      revision: 1,
      phase: 'playing',
      handNumber: 1,
      dealer,
      mano: (dealer + 1) % players,
      turn: 0,
      round: 1,
      scores: [3, 5],
      winner: -1,
      handWinner: -1,
      vira: { suit: 'cups', number: 12 },
      trucoValue: 1,
      mandatoryStack: false,
      florValid: false,
      hand: spectator
        ? []
        : [1, 2, 3].map((number, index) => ({
            index,
            card: { suit: 'spades' as const, number },
            used: index === 0,
          })),
      seats: Array.from({ length: players }, (_, seat) => ({
        seat,
        team: seat % 2,
        remaining: 2,
        plays: [
          {
            card: { suit: 'spades' as const, number: seat + 1 },
            present: true,
            burned: false,
            concealed: false,
          },
        ],
      })),
      payouts: [],
      envidoResults: [],
      legal: [],
    },
  };
}

export async function showTable(
  page: Page,
  initial: Snapshot,
  onCommand?: (command: Command) => void,
) {
  let snapshot = initial;
  let sendSnapshot: ((value: Snapshot) => void) | undefined;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') {
      await route.fulfill({ json: { id: 'player-0', name: 'Ana', registered: true } });
    } else if (path === `/api/matches/${snapshot.code}`) {
      await route.fulfill({ json: snapshot });
    } else {
      await route.fulfill({ status: 503, json: { error: 'Unavailable in UI test' } });
    }
  });
  await page.routeWebSocket(`**/api/matches/${snapshot.code}/ws`, (socket) => {
    sendSnapshot = (value) => socket.send(JSON.stringify({ type: 'snapshot', data: value }));
    sendSnapshot(snapshot);
    socket.onMessage((message) => {
      const command = JSON.parse(message.toString()).input?.command;
      if (command) onCommand?.(command);
    });
  });
  await page.goto(`/mesa/${snapshot.code}`);
  return (next: Snapshot) => {
    snapshot = next;
    sendSnapshot?.(snapshot);
  };
}
