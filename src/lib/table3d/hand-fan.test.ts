import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  cameraFieldOfView,
  clampLook,
  eyeDistance,
  eyeHeight,
  handLook,
  headPose,
  liftForPitch,
  lookAtSeat,
} from './camera.js';
import {
  cardHeight,
  cardWidth,
  fanGrip,
  fanOffset,
  fanScale,
  fanSlot,
  feltHeight,
  handFan,
} from './hand-fan.js';

function corners(lift: number, scale: number, index: number, count = 3, selected = false) {
  const fan = handFan(lift, scale, count);
  const slot = fanSlot(fan, fanOffset(fan, index, selected));
  const center = new Vector3(slot.x, slot.y, slot.z);
  const rotation = new Euler(fan.pitch, 0, slot.roll, 'YXZ');
  return {
    fan,
    slot,
    center,
    rotation,
    normal: new Vector3(0, 0, 1).applyEuler(rotation),
    points: [-1, 1].flatMap((x) =>
      [-1, 1].map((y) =>
        new Vector3((x * cardWidth * scale) / 2, (y * cardHeight * scale) / 2, 0)
          .applyEuler(rotation)
          .add(center),
      ),
    ),
  };
}

describe('seated first-person view', () => {
  it('clamps both controls to a forward arc and can face either adjacent caller', () => {
    const right = lookAtSeat(0, 1, 4);
    const left = lookAtSeat(0, 3, 4);
    expect(right.yaw).toBeCloseTo(-Math.PI / 4, 5);
    expect(left.yaw).toBeCloseTo(Math.PI / 4, 5);
    expect(clampLook(Math.PI, 0).yaw).toBeLessThan(Math.PI / 2);
    expect(headPose(clampLook(-Math.PI, -Math.PI))).toEqual({ yaw: -100, pitch: -100 });
  });

  it.each([0, 0.5, 1])(
    'keeps the held fan upright and anchored above the felt at lift %s',
    (lift) => {
      for (const scale of [0.48, 0.76, 0.86]) {
        for (const count of [1, 2, 3]) {
          for (let index = 0; index < count; index++) {
            const { normal, points } = corners(lift, scale, index, count);
            expect(normal.y).toBeGreaterThan(Math.sin(Math.PI / 12));
            expect(normal.y).toBeLessThan(Math.sin(Math.PI / 5));
            expect(Math.min(...points.map(({ y }) => y))).toBeGreaterThan(feltHeight + 0.06);
          }
        }
      }
    },
  );

  it.each([2, 3])('keeps %s cards overlapped and layered when one card rises', (count) => {
    const scale = 0.76;
    for (let i = 0; i < count - 1; i++) {
      const left = corners(1, scale, i, count, true);
      const right = corners(1, scale, i + 1, count);
      const separation = right.center.clone().sub(left.center).dot(left.normal);
      expect(separation).toBeGreaterThan(0.0005);
      expect(separation).toBeLessThan(0.002);
      // The tips spread outward while the lower edges still overlap.
      expect(left.points[2].x - right.points[0].x).toBeGreaterThan(cardWidth * scale * 0.25);
      expect(right.points[1].x - left.points[1].x).toBeGreaterThan(cardWidth * scale * 0.4);
    }
  });

  it.each([0.48, 0.76, 0.86])(
    'puts the thumb opposition inside the lower third of each supported card at scale %s',
    (scale) => {
      const support = (count: number, side: -1 | 1) => {
        const index = side < 0 ? 0 : count - 1;
        const { fan, slot, center, rotation } = corners(0.5, scale, index, count, true);
        const grip = fanGrip(fan, slot, side);
        const point = new Vector3(grip.x, grip.y, grip.z)
          .sub(center)
          .applyQuaternion(new Quaternion().setFromEuler(rotation).invert());
        expect(point.z).toBeCloseTo(0, 6);
        expect(Math.abs(point.x)).toBeLessThan((cardWidth * scale) / 2 - 0.014);
        const fromBottom = point.y + (cardHeight * scale) / 2;
        expect(fromBottom).toBeGreaterThan(cardHeight * scale * 0.24);
        expect(fromBottom).toBeLessThan(cardHeight * scale * 0.37);
        return grip.x;
      };
      const wide = support(3, 1) - support(3, -1);
      const close = support(2, 1) - support(2, -1);
      expect(wide).toBeGreaterThan(close * 1.35);
      expect(support(1, -1)).toBeLessThan(0);
    },
  );

  it('fits the complete fan in a 360 px portrait viewport when looking at the hand', () => {
    const aspect = 360 / 740;
    const camera = new PerspectiveCamera(cameraFieldOfView(aspect), aspect, 0.04, 24);
    camera.position.set(0, eyeHeight, eyeDistance);
    const look = handLook(aspect, 740);
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    for (const index of [0, 1, 2]) {
      for (const point of corners(liftForPitch(look.pitch), fanScale(aspect, 740), index).points) {
        point.project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.91);
        expect(Math.abs(point.y)).toBeLessThan(0.91);
      }
    }
  });

  it('fits the two-card fan inside the marked lower desktop area and centers the last card', () => {
    const aspect = 1440 / 960;
    const camera = new PerspectiveCamera(cameraFieldOfView(aspect), aspect, 0.04, 24);
    camera.position.set(0, eyeHeight, eyeDistance);
    const look = handLook(aspect, 960);
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    const lift = liftForPitch(look.pitch);
    const points = [0, 1].flatMap((index) =>
      corners(lift, fanScale(aspect, 960), index, 2).points.map((point) => point.project(camera)),
    );
    const xs = points.map(({ x }) => (x + 1) / 2);
    const ys = points.map(({ y }) => (1 - y) / 2);
    expect(Math.min(...xs)).toBeGreaterThan(0.27);
    expect(Math.max(...xs)).toBeLessThan(0.73);
    expect(Math.min(...ys)).toBeGreaterThan(0.53);
    expect(Math.max(...ys)).toBeLessThan(0.92);
    const one = corners(lift, fanScale(aspect, 960), 0, 1);
    const single = one.points.map((point) => point.project(camera));
    expect(
      Math.min(...single.map(({ x }) => x)) + Math.max(...single.map(({ x }) => x)),
    ).toBeCloseTo(0, 4);
  });
});
