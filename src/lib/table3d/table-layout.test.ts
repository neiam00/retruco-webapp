import { Box3, Euler, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { seatPoint, seatYaw } from './camera.js';
import { cardHeight, cardWidth, feltHeight } from './hand-fan.js';
import { deckSlot, playedSlot, viraSlot } from './table-layout.js';

function footprint(players: number, seat: number, slot: { x: number; z: number; roll: number }) {
  const center = seatPoint(seat, players, slot.x, 0, slot.z);
  const angle = new Euler(-Math.PI / 2, seatYaw(seat, players), slot.roll, 'YXZ');
  const points = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) =>
      new Vector3((x * cardWidth) / 2, (y * cardHeight) / 2, 0)
        .applyEuler(angle)
        .add(new Vector3(center.x, 0, center.z))
        .setY(0),
    ),
  );
  return new Box3().setFromPoints(points);
}

it.each([2, 4])(
  'gives each of %s seats a distinct played lane clear of the deck and vira',
  (players) => {
    const seats = Array.from({ length: players }, (_, seat) => seat);
    const lanes = seats.map((seat) =>
      [0, 1, 2].flatMap((round) =>
        [false, true].flatMap((stacked) =>
          [false, true].map((burned) =>
            footprint(players, seat, playedSlot(players, round, stacked, burned)),
          ),
        ),
      ),
    );
    for (const [seat, lane] of lanes.entries()) {
      const pockets = seats.flatMap((dealer) => [
        footprint(players, dealer, deckSlot),
        footprint(players, dealer, viraSlot),
      ]);
      for (const card of lane) {
        expect(pockets.some((pocket) => card.intersectsBox(pocket))).toBe(false);
        for (const other of lanes.slice(seat + 1)) {
          expect(other.some((neighbor) => card.intersectsBox(neighbor))).toBe(false);
        }
      }
    }
  },
);

it.each([2, 4])(
  'shows the face-up vira partly beneath each of %s possible dealers’ decks',
  (players) => {
    expect(viraSlot.y).toBeGreaterThan(feltHeight);
    expect(deckSlot.y - viraSlot.y).toBeGreaterThan(0.0005);
    expect(deckSlot.y - viraSlot.y).toBeLessThan(0.001);
    expect(viraSlot.z).toBeLessThan(deckSlot.z);
    for (let dealer = 0; dealer < players; dealer++) {
      const vira = footprint(players, dealer, viraSlot);
      const deck = footprint(players, dealer, deckSlot);
      const shared = vira.clone().intersect(deck);
      expect(shared.isEmpty()).toBe(false);
      const size = vira.getSize(new Vector3());
      const overlap = shared.getSize(new Vector3());
      const covered = (overlap.x * overlap.z) / (size.x * size.z);
      expect(covered).toBeGreaterThan(0.22);
      expect(covered).toBeLessThan(0.6);
    }
  },
);
