import type { Card } from './protocol.js';
import { CARD_ASSET_ORIGIN } from '$app/env/public';

const suitNames = { coins: 'oros', cups: 'copas', spades: 'espadas', clubs: 'bastos' };
export function cardName(card: Card) {
  return `${card.number} de ${suitNames[card.suit]}`;
}
export function cardURL(card?: Card) {
  const origin = CARD_ASSET_ORIGIN.replace(/\/$/, '');
  if (!card) return `${origin}/cards/card_back.svg`;
  const suit = card.suit === 'spades' ? 'swords' : card.suit;
  return `${origin}/cards/card_${suit}_${String(card.number).padStart(2, '0')}.svg`;
}
export const hierarchy = [
  'Perico',
  'Perica',
  '1 de espadas',
  '1 de bastos',
  '7 de espadas',
  '7 de oros',
  'Todos los 3',
  'Todos los 2',
  'Otros ases',
  'Todos los 12',
  'Otros 11',
  'Otros 10',
  '7 de bastos',
  '7 de copas',
  'Todos los 6',
  'Todos los 5',
  'Todos los 4',
];
