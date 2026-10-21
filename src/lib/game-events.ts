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
