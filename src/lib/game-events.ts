import { commandLabel, declarations } from './command-labels.js';
import type { Snapshot } from './protocol.js';

type PublicEvent = NonNullable<Snapshot['events']>[number]['event'];

export function eventLabel(event: PublicEvent): string {
  if (event.type === 'privo') {
    return event.kind === 'flor'
      ? 'Privando con flor: gana la partida'
      : `Privando: ${event.amount ?? 0} de envido`;
  }
  if (event.type === 'call' || event.type === 'respond') {
    const label = commandLabel(
      {
        type: event.type,
        kind: event.kind,
        amount: event.amount,
        mode: event.mode,
        declaration: event.text,
      },
      event.canto,
    );
    return event.automatic ? `Tiempo agotado: ${label}` : label;
  }
  if (event.automatic) return 'Tiempo agotado';
  if (!event.text) return '';
  return declarations.find((option) => option.value === event.text)?.label ?? '';
}

export function qualifiedEnvidoOpening(snapshot: Snapshot) {
  const game = snapshot.state;
  if (!game?.pending || !['envido', 'ley_envido'].includes(game.pending.kind)) return;

  const history = snapshot.cantoHistory?.length ? snapshot.cantoHistory : (snapshot.events ?? []);
  let opening: PublicEvent | undefined;
  for (let index = history.length - 1; index >= 0; index--) {
    const { hand, event } = history[index];
    if (hand !== game.handNumber) break;
    if (!opening) {
      if (event.type !== 'call') continue;
      if (event.kind !== game.pending.kind || !['con_ley', 'sin_ley'].includes(event.mode ?? ''))
        return;
      opening = event;
    } else if (
      event.text === 'a_ley' &&
      event.type === 'play' &&
      !event.automatic &&
      event.seat !== opening.seat
    ) {
      return { label: eventLabel(opening), speaker: event.seat };
    }
  }
  if (opening) return { label: eventLabel(opening) };
}
