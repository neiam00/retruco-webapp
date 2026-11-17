// Port of backend/cpu/policy.go. Golden native-Go decisions verify parity.
import type { Card, Command, CPURequest, CPUResponse } from '#lib/protocol.js';

// Same conservative proof as backend/cpu/public_truco.go. No hidden-card
// estimates or partner claims can turn a merely leading trick into certainty.
function publicTrucoWinner(view: CPURequest['view']): number | undefined {
  if (
    view.phase !== 'playing' ||
    !view.vira ||
    ![2, 4].includes(view.config.players) ||
    view.seats.length !== view.config.players ||
    view.round < 1 ||
    view.round > 2
  )
    return;
  const seen = new Set<number>();
  for (const seat of view.seats) {
    if (
      seat.seat < 0 ||
      seat.seat >= view.config.players ||
      seen.has(seat.seat) ||
      seat.team !== seat.seat % 2
    )
      return;
    seen.add(seat.seat);
  }
  function completed(round: number): number | undefined {
    let best = 0,
      winner = -1;
    for (const seat of view.seats) {
      const play = seat.plays[round];
      if (!play?.present || play.concealed || (!play.burned && !play.card)) return;
      if (play.burned) continue;
      const rank = strength(play.card!, view.vira!);
      if (rank > best) {
        best = rank;
        winner = seat.team;
      } else if (rank === best && winner !== seat.team) {
        winner = -1;
      }
    }
    return winner;
  }
  const first = completed(0);
  if (first === undefined || first < 0) return;
  if (view.round === 2) {
    const second = completed(1);
    if (second === undefined || second < 0 || second === first) return;
  }
  for (const seat of view.seats) {
    const play = seat.plays[view.round];
    if (
      play?.present &&
      !play.burned &&
      !play.concealed &&
      play.card &&
      strength(play.card, view.vira) === 17 &&
      (view.round === 2 || seat.team === first)
    )
      return seat.team;
  }
}

function strength(card: Card, vira: Card): number {
  if (card.suit === vira.suit) {
    if (card.number === (vira.number === 11 ? 12 : 11)) return 17;
    if (card.number === (vira.number === 10 ? 12 : 10)) return 16;
  }
  if (card.suit === 'spades' && card.number === 1) return 15;
  if (card.suit === 'clubs' && card.number === 1) return 14;
  if (card.number === 7) return { spades: 13, coins: 12, clubs: 5, cups: 4 }[card.suit];
  return (
    ({ 3: 11, 2: 10, 1: 9, 12: 8, 11: 7, 10: 6, 6: 3, 5: 2, 4: 1 } as Record<number, number>)[
      card.number
    ] ?? 0
  );
}

export function fallback(request: CPURequest): CPUResponse {
  const view = request.view;
  const result: CPUResponse = {
    version: request.version,
    revision: view.revision,
    seat: request.seat,
  };
  if (request.version === 2) {
    result.kind = request.kind;
    result.token = request.token;
  }
  if (![1, 2].includes(request.version) || !['1', '2'].includes(view.version)) {
    return { ...result, error: 'La versión del motor CPU no coincide. Recarga la página.' };
  }
  if (request.seat < 0 || request.seat >= view.config.players || view.legal.length > 1024) {
    return { ...result, error: 'La vista del jugador CPU no es válida.' };
  }
  if (request.version === 2 && request.kind === 'signal') return { ...result, signal: 'none' };
  if (!view.legal.length) return result;
  if (view.phase === 'cutting')
    return { ...result, command: view.legal[(request.entropy >>> 0) % view.legal.length] };
  if (!view.vira || !view.holding || view.round < 0 || view.round > 2) {
    return { ...result, error: 'Faltan las cartas del jugador CPU.' };
  }
  const holding = view.holding;
  const ordinaryFlor = view.florValid && holding.flor > 0 && !holding.receta;
  const strengths = new Map<number, number>();
  let remaining = 0,
    strongCards = 0,
    highest = 0,
    visibleBest = 0,
    teammateWinning = false;
  for (const card of view.hand) {
    if (card.used) continue;
    const value = strength(card.card, view.vira);
    strengths.set(card.index, value);
    remaining++;
    highest = Math.max(highest, value);
    if (value >= 12) strongCards++;
  }
  for (const other of view.seats) {
    const play = other.plays[view.round];
    if (!play?.card || play.burned || play.concealed) continue;
    const value = strength(play.card, view.vira);
    if (value > visibleBest) {
      visibleBest = value;
      teammateWinning = other.team === request.seat % 2;
    } else if (value === visibleBest && other.team !== request.seat % 2) teammateWinning = false;
  }
  function responseScore(command: Command): number {
    const pending = view.pending;
    if (pending?.kind === 'truco') {
      const winner = publicTrucoWinner(view);
      if (winner !== undefined)
        return (winner === request.seat % 2 && command.kind === 'accept') ||
          (winner !== request.seat % 2 && command.kind === 'decline')
          ? 200
          : -1000;
    }
    if (pending?.kind === 'privo') {
      if (command.kind === 'present_flor') return 200;
      let announced = 0;
      for (const value of view.privoEnvido ?? [])
        if (value.team === pending.caller) announced = value.value;
      const willing = holding.envido >= announced || strongCards >= 2;
      return (command.kind === 'accept' && willing) || (command.kind === 'decline' && !willing)
        ? 100
        : 20;
    }
    if (command.kind === 'flowers_no') return 200;
    let willing = false;
    if (pending?.kind === 'truco') {
      willing = strongCards > 0 || teammateWinning || (remaining === 1 && highest >= visibleBest);
      if (pending.value >= 9) willing = strongCards >= 2;
    } else if (pending) willing = holding.envido >= (pending.terminal ? 32 : 28);
    if (command.kind === 'accept') return willing ? 100 : 20;
    if (command.kind === 'decline') return willing ? 20 : 100;
    if (
      command.kind === 'raise' &&
      pending?.kind === 'truco' &&
      command.amount === 6 &&
      strongCards >= 2
    )
      return 115;
    return -1000;
  }
  function score(command: Command): number {
    let value = -1000;
    const card = strengths.get(command.card ?? 0) ?? 0;
    switch (command.type) {
      case 'play':
        value = teammateWinning
          ? 60 - card
          : visibleBest === 0
            ? 40 + card
            : card > visibleBest
              ? 80 - card
              : 30 - card;
        break;
      case 'stack':
        value = view.mandatoryStack ? 60 + 2 * (strengths.get(command.top ?? 0) ?? 0) + card : 10;
        break;
      case 'call':
        if (
          (command.kind === 'envido' || command.kind === 'ley_envido') &&
          holding.envido >= 30 &&
          (!ordinaryFlor || command.kind === 'ley_envido')
        )
          value = 110;
        if (command.kind === 'flor' && ordinaryFlor && holding.envido >= 30) value = 115;
        if (command.kind === 'truco' && command.amount === 3 && strongCards >= 2) value = 105;
        break;
      case 'respond':
        value = responseScore(command);
        break;
    }
    let expected = '';
    if (ordinaryFlor) {
      switch (command.type) {
        case 'play':
        case 'burn':
          expected =
            command.type === 'burn' && view.mandatoryStack
              ? 'flor_flor'
              : remaining === 1
                ? 'presento_flor'
                : command.type === 'play' && view.round === 0 && view.config.players === 4
                  ? 'a_ley'
                  : 'flor';
          break;
        case 'stack':
          expected = 'flor_flor';
          break;
        case 'call':
        case 'respond':
          expected = command.type === 'call' && command.kind === 'ley_envido' ? '' : 'con_mi_flor';
          if (command.type === 'respond' && view.pending?.kind === 'flor')
            expected = command.kind === 'decline' ? '' : 'con_flor';
          if (command.kind === 'flor' || command.kind === 'flowers_no') expected = '';
          break;
      }
    }
    if ((command.declaration ?? '') === expected) value += 5;
    if (
      (command.mode === 'con_ley' && ordinaryFlor) ||
      (command.mode === 'sin_ley' && !ordinaryFlor)
    )
      value++;
    return value;
  }
  let best = -100000;
  for (const command of view.legal) {
    const value = score(command);
    if (value > best) {
      best = value;
      result.command = command;
    }
  }
  return result;
}
