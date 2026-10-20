import { describe, expect, it } from 'vitest';
import { commandLabel } from './command-labels.js';

describe('manual canto declarations', () => {
  it('does not claim that an omitted flor declaration was spoken', () => {
    const command = { type: 'respond', kind: 'accept', declaration: '' };
    expect(commandLabel(command, 'flor')).toBe('Quiero');
    expect(commandLabel({ ...command, declaration: 'con_mi_flor' }, 'flor')).toBe(
      'Con mi flor, quiero',
    );
  });

  it('distinguishes the chosen ley comparison and whole-team flor refusal', () => {
    expect(commandLabel({ type: 'respond', kind: 'accept', mode: 'sin_ley' }, 'ley_envido')).toBe(
      'Sin ley, quiero',
    );
    expect(commandLabel({ type: 'respond', kind: 'decline' }, 'flor')).toBe(
      'Con mi flor me achico',
    );
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
