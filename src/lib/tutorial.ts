import type { Command, GameEvent, GameView } from './protocol.js';

export const tutorialStepIDs = [
  'vira',
  'pieces',
  'envido',
  'envido-accepted',
  'first-card',
  'first-trick',
  'truco',
  'truco-accepted',
  'perico',
  'recap',
] as const;

export type TutorialStepID = (typeof tutorialStepIDs)[number];

export interface TutorialStep {
  id: TutorialStepID;
  view: GameView;
  command?: Command;
  events?: GameEvent[];
}

export interface TutorialLesson {
  version: 1;
  steps: TutorialStep[];
}

export const tutorialCopy: Record<
  TutorialStepID,
  {
    title: string;
    body: string;
    why: string;
    action?: string;
  }
> = {
  vira: {
    title: 'Primero, mira la vira',
    body: 'La carta junto al mazo es la vira. En esta mano salió el 1 de oros: su palo determina las dos cartas más fuertes.',
    why: 'La vira no se juega. Cambia qué cartas son perico y perica en cada reparto; por eso conviene mirarla antes de elegir tu jugada.',
    action: 'Ver las cartas más fuertes',
  },
  pieces: {
    title: 'Encuentra tu perico',
    body: 'Con vira de oros, el 11 de oros es perico y el 10 de oros es perica. El perico gana a cualquier otra carta. Toca el perico en tu mano.',
    why: 'Perico y perica son, respectivamente, el 11 y el 10 del palo de la vira. Si la propia vira es un 11 o un 10, el 12 de ese palo reemplaza la pieza que falta.',
  },
  envido: {
    title: 'Canta envido antes de jugar',
    body: 'Tienes 37 de envido: 20 + los 10 del perico + los 7 del 7 de copas. Vamos a apostar esos tantos antes de jugar tu primera carta.',
    why: 'Para envido, el perico vale 10 y puede completar cualquier palo. Se toma la mejor pareja compatible. El envido inicial vale 2 piedras si lo aceptan y 1 si lo rechazan.',
    action: 'Cantar envido',
  },
  'envido-accepted': {
    title: 'La CPU dice «Quiero»',
    body: 'El envido quedó aceptado por 2 piedras. Todavía no se compara ni se suma: se resuelve al terminar la mano. Los tantos de la CPU siguen sin mostrarse.',
    why: 'Aceptar envido fija la apuesta y permite seguir jugando las cartas. Tener un buen envido no garantiza ganar el truco: son dos resultados distintos.',
    action: 'Jugar la primera carta',
  },
  'first-card': {
    title: 'Abre con el 7 de copas',
    body: 'En esta práctica, juega el 7 de copas y guarda el perico para después. La CPU jugará su respuesta.',
    why: 'También podrías jugar otra carta: no sería una jugada inválida. Esta mano preparada usa el 7 para que veas cómo ganar una vuelta y conservar una carta fuerte.',
  },
  'first-trick': {
    title: 'Ganaste la primera vuelta',
    body: 'Tu 7 de copas supera al 4 de copas de la CPU. Como ganaste esta vuelta, vuelves a abrir la siguiente.',
    why: 'Cada mano tiene hasta tres vueltas. Ganar las dos primeras decide el truco sin necesitar la tercera. Los empardes tienen reglas especiales que puedes consultar después.',
    action: 'Probar un truco',
  },
  truco: {
    title: 'Sube la apuesta con truco',
    body: 'Ya tienes la primera vuelta y conservas el perico. Canta truco antes de jugar tu segunda carta: si la CPU acepta, el truco pasará de 1 a 3 piedras.',
    why: 'El truco apuesta por el resultado de las cartas. Cantar no obliga al rival a aceptar: rechazar el truco inicial entrega 1 piedra. En esta práctica la CPU aceptará.',
    action: 'Cantar truco',
  },
  'truco-accepted': {
    title: 'El truco ahora vale 3',
    body: 'La CPU aceptó. El juego de cartas continúa y el ganador del truco cobrará 3 piedras. El envido de 2 sigue pendiente por separado.',
    why: 'El canto pausa las cartas mientras se responde. Aceptarlo cambia cuánto vale la mano, pero no cambia qué carta gana una vuelta.',
    action: 'Resolver la segunda vuelta',
  },
  perico: {
    title: 'Ahora juega el perico',
    body: 'Juega tu 11 de oros. La CPU responderá con una carta fuerte, pero el perico sigue siendo la más alta de esta mano.',
    why: 'La fuerza depende de la vira. Aquí el 11 de oros es perico y vence incluso a la perica. Si ganas esta vuelta, ya tendrás dos vueltas y el truco quedará decidido.',
  },
  recap: {
    title: 'Ya jugaste tu primera mano',
    body: 'Ganaste dos vueltas: el 7 superó al 4 y el perico superó a la perica. Tus 37 también ganaron el envido frente a los 34 de la CPU.',
    why: 'Se suman las 2 piedras del envido aceptado y las 3 del truco aceptado. No hubo flor. En una partida normal, se siguen repartiendo manos hasta alcanzar el objetivo de la mesa.',
  },
};

// This is a read-only, versioned lesson. An incomplete response must not let a
// learner advance through an unrelated or missing game state.
export function isTutorialLesson(value: unknown): value is TutorialLesson {
  if (!value || typeof value !== 'object') return false;
  const lesson = value as Partial<TutorialLesson>;
  return (
    lesson.version === 1 &&
    Array.isArray(lesson.steps) &&
    lesson.steps.length === tutorialStepIDs.length &&
    lesson.steps.every(
      (step, index) =>
        step?.id === tutorialStepIDs[index] &&
        step.view?.config?.players === 2 &&
        Array.isArray(step.view.hand) &&
        Array.isArray(step.view.seats) &&
        step.view.seats.length === 2 &&
        Array.isArray(step.view.legal) &&
        Array.isArray(step.view.scores),
    )
  );
}

export function hasLessonCommand(step: TutorialStep): boolean {
  const expected = step.command;
  return (
    !!expected &&
    step.view.legal.some(
      (command) =>
        command.type === expected.type &&
        (command.kind ?? '') === (expected.kind ?? '') &&
        (command.amount ?? 0) === (expected.amount ?? 0) &&
        (command.card ?? 0) === (expected.card ?? 0),
    )
  );
}
