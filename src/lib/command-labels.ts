import type { Command } from './protocol.js';

export const declarations = [
  { value: '', label: 'Sin declaración' },
  { value: 'flor', label: 'Flor' },
  { value: 'a_ley', label: 'A ley' },
  { value: 'presento_flor', label: 'Presento flor' },
  { value: 'flor_flor', label: 'Flor flor' },
  { value: 'con_mi_flor', label: 'Con mi flor…' },
];
export function cantoName(kind: string) {
  return (
    (
      {
        truco: 'Truco',
        envido: 'Envido',
        ley_envido: 'A ley, envido',
        flor: 'Flor tengo y la mía envida',
        privo: 'Privo',
      } as Record<string, string>
    )[kind] ?? kind
  );
}
export function commandLabel(command: Command, pendingKind?: string) {
  const label = actionLabel(command, pendingKind);
  const florPrefix =
    command.declaration === 'con_flor'
      ? 'Con flor'
      : declarations.find((option) => option.value === command.declaration)?.label.replace('…', '');
  const hasExplicitFlorWording =
    command.kind === 'flor' ||
    command.kind === 'flowers_no' ||
    (command.kind === 'decline' && pendingKind === 'flor');

  if (
    command.declaration &&
    florPrefix &&
    command.declaration !== 'a_ley' &&
    !hasExplicitFlorWording
  ) {
    return `${florPrefix}, ${label.toLowerCase()}`;
  }
  return label;
}

function actionLabel(command: Command, pendingKind?: string) {
  if (pendingKind === 'privo') {
    if (command.kind === 'accept') return 'Privo y Truco';
    if (command.kind === 'decline') return 'No jugar';
    if (command.kind === 'present_flor') return 'Presentar flor';
  }
  if (command.type === 'call') {
    if (command.kind === 'truco')
      return (
        { 3: 'Truco', 6: 'Retruco', 9: 'Vale 9', 100: 'Vale partida' } as Record<number, string>
      )[command.amount ?? 3];
    if (['envido', 'ley_envido'].includes(command.kind ?? '') && command.mode) {
      return command.mode === 'con_ley' ? 'Con ley, envido' : 'Sin ley, envido';
    }
    return cantoName(command.kind ?? '');
  }
  if (command.kind === 'flowers_no') return 'A las flores no';
  if (command.kind === 'decline')
    return pendingKind === 'flor'
      ? 'Con mi flor me achico'
      : command.mode === 'sin_ley'
        ? 'Sin ley, no quiero'
        : 'No quiero';
  const acceptance =
    command.mode === 'con_ley'
      ? 'Con ley, quiero'
      : command.mode === 'sin_ley'
        ? 'Sin ley, quiero'
        : 'Quiero';
  if (command.kind === 'accept') return acceptance;
  if (command.kind === 'falta') return `${acceptance} y envido la falta`;
  if (command.kind === 'raise' && pendingKind === 'truco')
    return `Quiero y ${({ 6: 'retruco', 9: 'vale 9', 100: 'vale partida' } as Record<number, string>)[command.amount ?? 0]}`;
  if (command.kind === 'raise')
    return `${acceptance} y ${command.amount === 2 ? 'envido' : `${command.amount} piedras más`}`;
  return command.type;
}
