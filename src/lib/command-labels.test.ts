import { describe, expect, it } from 'vitest';
import { commandLabel } from './command-labels.js';

describe('manual canto declarations', () => {
  it('does not claim that an omitted flor declaration was spoken', () => {
    const command = { type: 'respond', kind: 'accept', declaration: '' };
    expect(commandLabel(command, 'flor')).toBe('Quiero');
    expect(commandLabel({ ...command, declaration: 'con_flor' }, 'flor')).toBe('Con flor, quiero');
  });

  it('distinguishes a bare ley, a qualified opening, and a previously announced flor', () => {
    expect(commandLabel({ type: 'call', kind: 'ley_envido' })).toBe('A ley, envido');
    expect(commandLabel({ type: 'call', kind: 'ley_envido', mode: 'con_ley' })).toBe(
      'Con ley, envido',
    );
    expect(commandLabel({ type: 'call', kind: 'flor' })).toBe('Flor tengo y la mía envida');
  });

  it.each(['ley_envido', 'flor'])('renders the actual reply to %s', (kind) => {
    expect(commandLabel({ type: 'respond', kind: 'decline', mode: 'con_ley' }, kind)).toBe(
      'Con ley, no quiero',
    );
    expect(commandLabel({ type: 'respond', kind: 'decline', mode: 'sin_ley' }, kind)).toBe(
      'Sin ley, no quiero',
    );
    expect(commandLabel({ type: 'respond', kind: 'decline' }, kind)).toBe('No quiero');
  });

  it('distinguishes a truco declaration from a qualified flor raise', () => {
    expect(commandLabel({ type: 'call', kind: 'truco', declaration: 'con_mi_flor' })).toBe(
      'Con mi flor, truco',
    );
    expect(
      commandLabel({ type: 'respond', kind: 'raise', amount: 2, mode: 'con_ley' }, 'flor'),
    ).toBe('Con ley, quiero y envido');
  });

  it.each([
    ['con_ley', 'Con ley, quiero'],
    ['sin_ley', 'Sin ley, quiero'],
  ])('puts %s before acceptance and counter-raises', (mode, acceptance) => {
    expect(commandLabel({ type: 'respond', kind: 'accept', mode }, 'ley_envido')).toBe(acceptance);
    expect(commandLabel({ type: 'respond', kind: 'raise', amount: 2, mode }, 'ley_envido')).toBe(
      `${acceptance} y envido`,
    );
    expect(commandLabel({ type: 'respond', kind: 'falta', mode }, 'ley_envido')).toBe(
      `${acceptance} y envido la falta`,
    );
  });
});
