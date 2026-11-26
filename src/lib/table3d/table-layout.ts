import { feltHeight } from './hand-fan.js';

export const tableY = feltHeight + 0.007;
export const deckLayerSpacing = 0.0016;
export const deckSlot = { x: 0.343, y: feltHeight + 0.002, z: 0.328, roll: 0.09 };
export const viraSlot = { x: 0.365, y: feltHeight + 0.00125, z: 0.229, roll: -0.025 };

export function playedSlot(players: number, round: number, stacked: boolean, burned: boolean) {
  const paired = stacked && round > 0;
  const spacing = players === 4 ? 0.073 : 0.142;
  // Bias every four-seat lane in its local direction so it can sit close to the center.
  const lane = players === 4 ? -0.093 : 0;
  return {
    x: lane + (paired ? spacing * 0.38 + (round - 1) * 0.018 : (round - 1) * spacing),
    y: tableY + 0.003 * (round + 1),
    z: 0.205 + (paired ? (round - 1) * 0.018 : 0),
    roll: (round - 1) * (burned ? 0.1 : 0.035),
  };
}
