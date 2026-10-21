export interface Card {
  suit: 'coins' | 'cups' | 'spades' | 'clubs';
  number: number;
}
export interface User {
  id: string;
  name: string;
  registered: boolean;
}
export interface Config {
  players: number;
  target: number;
  florRequired: boolean;
}
export interface Command {
  type: string;
  card?: number;
  top?: number;
  cut?: number;
  kind?: string;
  amount?: number;
  declaration?: string;
  mode?: string;
}
export interface Wager {
  kind: string;
  caller: number;
  value: number;
  previous: number;
  terminal: boolean;
  mode?: string;
}
export interface GameView {
  config: Config;
  version: string;
  revision: number;
  phase: string;
  handNumber: number;
  dealer: number;
  mano: number;
  turn: number;
  round: number;
  vira?: Card;
  scores: [number, number];
  winner: number;
  handWinner: number;
  pending?: Wager;
  suspended?: Wager;
  trucoValue: number;
  mandatoryStack: boolean;
  seats: {
    seat: number;
    team: number;
    remaining: number;
    plays: { card?: Card; present: boolean; burned: boolean; concealed: boolean }[];
  }[];
  hand: { index: number; card: Card; used: boolean }[];
  preview?: Card;
  holding?: { envido: number; flor: number; receta: boolean };
  florValid: boolean;
  legal: Command[];
  payouts: { kind: string; team: number; points: number }[];
  envidoResults?: { seat: number; value: number; eligible: boolean }[];
}
export interface GameEvent {
  id: number;
  hand: number;
  event: {
    type: string;
    seat: number;
    text?: string;
    kind?: string;
    canto?: string;
    amount?: number;
    mode?: string;
    automatic?: boolean;
  };
}
export interface Snapshot {
  options?: { spectatorsCanSpeak: boolean; cpuSeats?: number[] };
  cpuController?: number;
  cpuPaused?: boolean;
  code: string;
  private: boolean;
  config: Config;
  seats: { id: string; name: string; cpu?: boolean }[];
  seat: number;
  perspective: number;
  state?: GameView;
  deadline: string;
  serverTime: string;
  sequence: number;
  chat: { id: number; name: string; text: string; spectator: boolean }[];
  signals: { id: number; seat: number; kind: string }[];
  events?: GameEvent[];
  cantoHistory?: GameEvent[];
}
export interface Listing {
  cpuPlayers?: number;
  code: string;
  players: number;
  capacity: number;
  target: number;
  florRequired: boolean;
  started: boolean;
  host: string;
}

export interface CPUWork {
  version: number;
  controlled: boolean;
  seat: number;
  view?: GameView;
}
export interface CPURequest {
  version: number;
  seat: number;
  entropy: number;
  view: GameView;
}
export interface CPUResponse {
  version: number;
  revision: number;
  seat: number;
  command?: Command;
  error?: string;
}
export interface HistoryEntry {
  code: string;
  scores: [number, number];
  winner: number;
  finished: boolean;
  expired?: boolean;
  updatedAt: string;
  team: number;
  players: { name: string; seat: number; team: number; cpu: boolean }[];
}
