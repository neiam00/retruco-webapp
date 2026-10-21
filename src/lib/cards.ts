import type { Card } from './protocol.js';
import { CARD_ASSET_ORIGIN } from '$app/env/public';
import assets from './card-assets.json';

const cardAssets: Record<string, string> = assets;

const suitNames = { coins: 'oros', cups: 'copas', spades: 'espadas', clubs: 'bastos' };
export function cardName(card: Card) {
  return `${card.number} de ${suitNames[card.suit]}`;
}
export function cardURL(card?: Card) {
  if (!card) return assetURL(cardAssets.card_back);
  const suit = card.suit === 'spades' ? 'swords' : card.suit;
  return assetURL(cardAssets[`card_${suit}_${String(card.number).padStart(2, '0')}`]);
}

export function deckImageURLs(): string[] {
  return Object.values(cardAssets).map(assetURL);
}

function assetURL(filename: string): string {
  const origin = CARD_ASSET_ORIGIN.replace(/\/$/, '');
  return `${origin}/cards/${filename}`;
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
