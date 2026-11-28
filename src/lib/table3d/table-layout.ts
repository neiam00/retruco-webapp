import { cardThickness, feltHeight } from './hand-fan.js';

const cardSurface = feltHeight + cardThickness + 0.00035;
export const deckLayerSpacing = cardThickness + 0.00013;
export const deckSlot = { x: 0.343, y: cardSurface + deckLayerSpacing, z: 0.328, roll: 0.09 };
export const viraSlot = { x: 0.365, y: cardSurface, z: 0.229, roll: -0.025 };

export function playedSlot(players: number, round: number, stacked: boolean, burned: boolean) {
  const paired = stacked && round > 0;
  const spacing = players === 4 ? 0.073 : 0.142;
  // Bias every four-seat lane in its local direction so it can sit close to the center.
  const lane = players === 4 ? -0.093 : 0;
  return {
    x: lane + (paired ? spacing * 0.38 + (round - 1) * 0.018 : (round - 1) * spacing),
    y: cardSurface + round * deckLayerSpacing,
    z: 0.205 + (paired ? (round - 1) * 0.018 : 0),
    roll: (round - 1) * (burned ? 0.1 : 0.035),
  };
}
