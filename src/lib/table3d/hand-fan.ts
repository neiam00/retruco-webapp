import { seatDistance } from './camera.js';

export const feltHeight = 0.76;
export const cardWidth = 0.117;
export const cardHeight = 0.177;
export const gripBindPitch = -0.4;
export const gripTransferDuration = 0.09;

export interface FanSlot {
  x: number;
  y: number;
  z: number;
  roll: number;
}

export interface FanOffset {
  x: number;
  rise: number;
  layer: number;
  roll: number;
}

export interface CardGrip extends FanSlot {
  pitch: number;
  index: number;
  amount: number;
}

export interface HandGrips {
  left: CardGrip;
  right: CardGrip;
}

export function fanScale(aspect: number, height: number) {
  const compact = aspect >= 0.9 ? Math.min(0.06, Math.max(0, (840 - height) * 0.00043)) : 0;
  return Math.min(0.76 - compact, Math.max(0.48, aspect / 0.66));
}

export function handFan(lift: number, scale: number, count: number) {
  const pitch = gripBindPitch + 0.1 * lift;
  const upY = Math.cos(pitch);
  const upZ = Math.sin(pitch);
  const distance = cardHeight * 0.41 * scale;
  const y = 0.899 + 0.081 * lift + upY * distance + 0.012;
  const z = seatDistance - 0.372 + 0.024 * lift + upZ * distance - 0.0036;
  return { y, z, pitch, upY, upZ, scale, count };
}

export type HandFan = ReturnType<typeof handFan>;

export function fanOffset(
  fan: HandFan,
  index: number,
  selected: boolean,
  offset: FanOffset = { x: 0, rise: 0, layer: 0, roll: 0 },
) {
  const spread = index - (fan.count - 1) / 2;
  const spacing = fan.count === 2 ? 0.068 : 0.064;
  offset.x = spread * spacing;
  offset.rise = (selected ? 0.027 : 0) - Math.abs(spread) * 0.007;
  offset.layer = spread * 0.0008;
  offset.roll = -spread * (fan.count === 2 ? 0.24 : 0.17);
  return offset;
}

export function fanSlot(
  fan: HandFan,
  offset: FanOffset,
  slot: FanSlot = { x: 0, y: 0, z: 0, roll: 0 },
) {
  const rise = offset.rise * fan.scale;
  // Keep the paper layers parallel, including while the fan closes or a card rises.
  slot.x = offset.x * fan.scale;
  slot.y = fan.y + rise * fan.upY - offset.layer * fan.upZ;
  slot.z = fan.z + rise * fan.upZ + offset.layer * fan.upY;
  slot.roll = offset.roll;
  return slot;
}

export function fanGrip(
  fan: HandFan,
  card: FanSlot,
  side: -1 | 1,
  grip: FanSlot = { x: 0, y: 0, z: 0, roll: 0 },
) {
  // Set the pinch slightly outside the center and above the lower edge of the
  // outer card. The pad has room even when the next card overlaps the inside.
  const x = side * cardWidth * fan.scale * 0.19;
  const y = -cardHeight * fan.scale * 0.18;
  const sine = Math.sin(card.roll);
  const cosine = Math.cos(card.roll);
  const rise = x * sine + y * cosine;
  grip.x = card.x + x * cosine - y * sine;
  grip.y = card.y + rise * fan.upY;
  grip.z = card.z + rise * fan.upZ;
  grip.roll = card.roll;
  return grip;
}
