import { expect, it } from 'vitest';
import { eventLabel } from './game-events.js';
import { commandLabel } from './command-labels.js';

it('distinguishes truthful team announcements from timeout responses', () => {
  // The server omits zero-valued event amounts from JSON.
  expect(eventLabel({ type: 'privo', seat: -1, team: 0, kind: 'envido', automatic: true })).toBe(
    'Privando: 0 de envido',
  );
  expect(
    eventLabel({ type: 'privo', seat: -1, team: 0, kind: 'envido', amount: 33, automatic: true }),
  ).toBe('Privando: 33 de envido');
  expect(eventLabel({ type: 'privo', seat: -1, team: 1, kind: 'flor', automatic: true })).toBe(
    'Privando con flor: gana la partida',
  );
  expect(
    eventLabel({ type: 'respond', seat: 1, kind: 'decline', canto: 'privo', automatic: true }),
  ).toBe('Tiempo agotado: No jugar');
  expect(commandLabel({ type: 'respond', kind: 'accept' }, 'privo')).toBe('Privo y Truco');
  expect(commandLabel({ type: 'respond', kind: 'present_flor' }, 'privo')).toBe('Presentar flor');
});
