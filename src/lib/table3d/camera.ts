export interface LookAngles {
  yaw: number;
  pitch: number;
}

export interface HeadPose {
  yaw: number;
  pitch: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const seatDistance = 1.02;
export const eyeHeight = 1.32;
export const eyeDistance = 0.86;
export const yawLimit = radians(78);
export const pitchDown = radians(-62);
export const pitchUp = radians(20);
export const neutralLook: Readonly<LookAngles> = { yaw: 0, pitch: radians(-20) };
export const centeredTableLook: Readonly<LookAngles> = { yaw: 0, pitch: radians(-29) };
export function handLook(aspect: number, height: number): LookAngles {
  if (aspect < 0.9) return { yaw: 0, pitch: radians(-40.2) };
  const compact = Math.min(1, Math.max(0, (900 - height) / 240));
  let pitch = radians(-40.6 - 4.1 * compact);
  if (aspect > 1 && height > 0) {
    // In short landscape the expanded action dock uses about 188 CSS pixels.
    // Reserve a 44 px strip of the fan above it, including before the dock opens.
    const clearance = Math.max(0, 188 + 44 - height / 2);
    const focalLength = height / (2 * Math.tan(radians(cameraFieldOfView(aspect)) / 2));
    pitch -= Math.atan2(clearance, focalLength);
  }
  return { yaw: 0, pitch: Math.max(pitchDown, pitch) };
}

export function cameraFieldOfView(aspect: number) {
  const vertical = 2 * Math.atan(Math.tan(radians(24.5)) / aspect);
  return Math.min(92, Math.max(57, (vertical * 180) / Math.PI));
}

export function seatYaw(seat: number, players: number) {
  return (seat * Math.PI * 2) / players;
}

export function seatPoint(seat: number, players: number, x: number, y: number, z: number) {
  const yaw = seatYaw(seat, players);
  const sine = Math.sin(yaw);
  const cosine = Math.cos(yaw);
  return { x: x * cosine + z * sine, y, z: z * cosine - x * sine };
}

export function clampLook(yaw: number, pitch: number): LookAngles {
  return {
    yaw: Math.min(yawLimit, Math.max(-yawLimit, yaw)),
    pitch: Math.min(pitchUp, Math.max(pitchDown, pitch)),
  };
}

export function lookAtSeat(viewer: number, speaker: number, players: number): LookAngles {
  const eye = seatPoint(viewer, players, 0, eyeHeight, eyeDistance);
  const face = seatPoint(speaker, players, 0, 1.28, eyeDistance);
  const x = face.x - eye.x;
  const z = face.z - eye.z;
  const worldYaw = Math.atan2(-x, -z) - seatYaw(viewer, players);
  return clampLook(
    Math.atan2(Math.sin(worldYaw), Math.cos(worldYaw)),
    Math.atan2(face.y - eye.y, Math.hypot(x, z)),
  );
}

export function headPose(look: LookAngles): HeadPose {
  const pitch = look.pitch / (look.pitch < 0 ? -pitchDown : pitchUp);
  return { yaw: Math.round((look.yaw / yawLimit) * 100), pitch: Math.round(pitch * 100) };
}

export function liftForPitch(pitch: number) {
  // Seat-anchored hands sit low during eye contact and rise during inspection.
  const amount = Math.max(0, Math.min(1, (neutralLook.pitch - pitch) / radians(28)));
  return amount * amount * (3 - 2 * amount);
}

export function damp(value: number, target: number, dt: number, rate = 9) {
  return target + (value - target) * Math.exp(-dt * rate);
}
