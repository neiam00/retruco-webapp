import { describe, expect, it } from 'vitest';
import { teamLabel, victoryLabel } from './team-labels.js';

describe('team labels from the viewer’s seat', () => {
  it.each([
    [0, 'Nosotros', 'Ellos'],
    [1, 'Ellos', 'Nosotros'],
    [2, 'Nosotros', 'Ellos'],
    [3, 'Ellos', 'Nosotros'],
    [-1, 'Equipo 1', 'Equipo 2'],
  ])('labels both teams for seat %i', (seat, first, second) => {
    expect(teamLabel(0, seat)).toBe(first);
    expect(teamLabel(1, seat)).toBe(second);
  });

  it('uses the appropriate winner wording for players and spectators', () => {
    expect(victoryLabel(1, 1)).toBe('¡Ganamos nosotros!');
    expect(victoryLabel(1, 0)).toBe('¡Ganaron ellos!');
    expect(victoryLabel(1, -1)).toBe('¡Ganó el equipo 2!');
  });
});
