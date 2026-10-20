// Teams and seats are zero-based. A negative seat identifies a spectator,
// regardless of which player's hand they are currently watching.
export function teamLabel(team: number, viewerSeat: number): string {
  if (viewerSeat < 0) return `Equipo ${team + 1}`;
  return team === viewerSeat % 2 ? 'Nosotros' : 'Ellos';
}

export function victoryLabel(team: number, viewerSeat: number): string {
  if (viewerSeat < 0) return `¡Ganó el equipo ${team + 1}!`;
  return team === viewerSeat % 2 ? '¡Ganamos nosotros!' : '¡Ganaron ellos!';
}
