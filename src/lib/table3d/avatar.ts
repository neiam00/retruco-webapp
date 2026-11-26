import * as THREE from 'three';
import { asset } from '$app/paths';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Appearance } from '#lib/appearance.js';
import { damp, seatDistance, type LookAngles } from './camera.js';
import { gripBindPitch, gripTransferDuration, type CardGrip, type HandGrips } from './hand-fan.js';

export interface AvatarAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface TableAvatar {
  object: THREE.Group;
  play(name: string, duration?: number): void;
  update(dt: number, head?: LookAngles, mouth?: number, grips?: HandGrips, animate?: boolean): void;
  setAppearance(appearance: Appearance): void;
  firstPerson(enabled: boolean): void;
  resetGrip(): void;
  signal(kind: string): void;
  dispose(): void;
}

export const skinColors = [0xf4c69f, 0xdba87c, 0xb98154, 0xa16446, 0x7a4b36, 0x523527];
const nailHighlight = new THREE.Color(0xffd5c5);
const shirts = [0xd8caaa, 0x7c4139, 0x1d5c50, 0x4c605e, 0xa48640, 0x263851, 0x73617a, 0xc2aa80];
const hairColors = [0x33251d, 0x241c18, 0x322720, 0x211d1c];
const partNames = {
  base: ['Head0', 'Head1', 'Head2', 'Head3'],
  body: ['Body0', 'Body1', 'Body2', 'Body3'],
  hair: ['', 'HairCrop', 'HairWave', 'HairPart', 'HairCurly'],
  hat: ['', 'HatCap', 'HatBeret', 'HatBrim'],
  glasses: ['', 'GlassesSun', 'GlassesRound'],
};

const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const paperEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const bindPaper = new THREE.Quaternion().setFromAxisAngle(xAxis, -gripBindPitch);
const paperUp = yAxis.clone().applyQuaternion(bindPaper);
const inverse = new THREE.Quaternion();
const adjustment = new THREE.Quaternion();
const shoulderRotation = new THREE.Quaternion();
const elbowRotation = new THREE.Quaternion();
const wristRotation = new THREE.Quaternion();
const paperRotation = new THREE.Quaternion();
const shoulder = new THREE.Vector3();
const elbow = new THREE.Vector3();
const wrist = new THREE.Vector3();
const wristDirection = new THREE.Vector3();
const wristTarget = new THREE.Vector3();
const elbowBend = new THREE.Vector3();
const curlAngles = {
  IndexCurl: 0.26,
  MiddleCurl: 0.4,
  RingCurl: 0.55,
  LittleCurl: 0.68,
};

function bindArm(model: THREE.Object3D, side: 'L' | 'R') {
  const joint = (name: string) =>
    model.getObjectByName(name + side) ?? model.getObjectByName(`${name}.${side}`);
  const upper = joint('Arm');
  const forearm = joint('Forearm');
  const hand = joint('Hand');
  const grip = joint('Grip');
  const thumb = joint('Thumb');
  if (!upper || !forearm || !hand || !grip) return;
  const forearmInverse = forearm.getWorldQuaternion(new THREE.Quaternion()).invert();
  const curls = Object.entries(curlAngles).flatMap(([name, angle]) => {
    const node = joint(name);
    return node ? [{ node, angle }] : [];
  });
  return {
    side,
    upper,
    forearm,
    hand,
    grip,
    curls,
    joints: [upper, forearm, hand, ...(thumb ? [thumb] : []), ...curls.map(({ node }) => node)].map(
      (node) => ({ node, base: node.quaternion.clone() }),
    ),
    shoulderAxis: forearm.position.clone().normalize(),
    elbowAxis: hand.position.clone().normalize(),
    upperLength: forearm.position.length(),
    forearmLength: hand.position.length(),
    lowerAxis: xAxis.clone().applyQuaternion(forearmInverse),
    outwardAxis: yAxis.clone().applyQuaternion(forearmInverse),
    paperToHand: bindPaper
      .clone()
      .invert()
      .multiply(hand.getWorldQuaternion(new THREE.Quaternion())),
    thumb,
    thumbAxis: thumb && paperUp.clone().applyQuaternion(thumb.getWorldQuaternion(inverse).invert()),
    holding: 0,
    gesturing: 0,
    index: -1,
    transfer: 1,
    contact: new THREE.Vector3(),
    from: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    fromOrientation: new THREE.Quaternion(),
  };
}

type Arm = NonNullable<ReturnType<typeof bindArm>>;

function poseArm(
  arm: Arm,
  object: THREE.Object3D,
  target: CardGrip | undefined,
  gesture: boolean,
  dt: number,
  snap: boolean,
) {
  const { upper, forearm, hand } = arm;
  const amount = target?.amount ?? 0;
  arm.gesturing = snap ? Number(gesture) : damp(arm.gesturing, Number(gesture), dt, 30);
  if (Math.abs(arm.gesturing - Number(gesture)) < 0.002) arm.gesturing = Number(gesture);
  const holding = amount * (1 - arm.gesturing);
  arm.holding = snap ? holding : damp(arm.holding, holding, dt, 36);
  if (Math.abs(arm.holding - holding) < 0.002) arm.holding = holding;

  if (target && amount > 0) {
    if (snap || arm.index < 0) arm.transfer = 1;
    else if (arm.index !== target.index) {
      arm.from.copy(arm.contact);
      arm.fromOrientation.copy(arm.orientation);
      arm.transfer = 0;
    }
    arm.index = target.index;
    arm.transfer = Math.min(1, arm.transfer + dt / gripTransferDuration);
    const ease = arm.transfer * arm.transfer * (3 - 2 * arm.transfer);
    // The rig faces +Z. Scene slots use +Z toward the seated player.
    arm.contact.set(-target.x, target.y, seatDistance - target.z).lerp(arm.from, 1 - ease);
    arm.orientation
      .setFromEuler(paperEuler.set(-target.pitch, 0, -target.roll))
      .multiply(arm.paperToHand)
      .slerp(arm.fromOrientation, 1 - ease);
  }

  const relaxed = (1 - arm.holding) * (1 - arm.gesturing);
  const outward = arm.side === 'L' ? 1 : -1;
  forearm.quaternion.multiply(
    adjustment.setFromAxisAngle(arm.outwardAxis, 0.42 * outward * relaxed),
  );
  forearm.quaternion.multiply(adjustment.setFromAxisAngle(arm.lowerAxis, 0.12 * relaxed));
  forearm.quaternion.multiply(adjustment.setFromAxisAngle(yAxis, 1.14 * outward * relaxed));
  hand.quaternion.multiply(adjustment.setFromAxisAngle(yAxis, 0.55 * outward * relaxed));
  if (arm.thumb && arm.thumbAxis)
    arm.thumb.quaternion.multiply(
      adjustment.setFromAxisAngle(arm.thumbAxis, 0.17 * outward * relaxed),
    );
  for (const { node, angle } of arm.curls)
    node.quaternion.multiply(adjustment.setFromAxisAngle(xAxis, angle * relaxed));
  if (!arm.holding) {
    if (amount === 0) arm.index = -1;
    return;
  }

  upper.getWorldPosition(shoulder);
  upper.getWorldQuaternion(shoulderRotation);
  elbow.copy(forearm.position).applyQuaternion(shoulderRotation).add(shoulder);
  elbowRotation.copy(shoulderRotation).multiply(forearm.quaternion);
  wrist.copy(hand.position).applyQuaternion(elbowRotation).add(elbow);
  wristRotation.copy(elbowRotation).multiply(hand.quaternion);
  object.getWorldQuaternion(paperRotation).multiply(arm.orientation);
  object
    .localToWorld(wristTarget.copy(arm.contact))
    .sub(wristDirection.copy(arm.grip.position).applyQuaternion(paperRotation));
  wrist.lerp(wristTarget, arm.holding);
  wristRotation.slerp(paperRotation, arm.holding);

  // Keep the upper- and forearm lengths fixed and take the elbow's bend plane
  // from the animated rig, so the shoulders and cuffs follow naturally.
  wristDirection.copy(wrist).sub(shoulder);
  const distance = THREE.MathUtils.clamp(
    wristDirection.length(),
    Math.abs(arm.upperLength - arm.forearmLength) + 0.001,
    arm.upperLength + arm.forearmLength - 0.001,
  );
  wristDirection.normalize();
  elbowBend.copy(elbow).sub(shoulder);
  elbowBend.addScaledVector(wristDirection, -elbowBend.dot(wristDirection)).normalize();
  const along = (arm.upperLength ** 2 - arm.forearmLength ** 2 + distance ** 2) / (2 * distance);
  const away = Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2));
  elbow.copy(shoulder).addScaledVector(wristDirection, along).addScaledVector(elbowBend, away);
  wrist.copy(shoulder).addScaledVector(wristDirection, distance);

  inverse.copy(shoulderRotation).invert();
  elbowBend.copy(elbow).sub(shoulder).normalize().applyQuaternion(inverse);
  adjustment.setFromUnitVectors(arm.shoulderAxis, elbowBend);
  upper.quaternion.multiply(adjustment);
  shoulderRotation.multiply(adjustment);
  elbowRotation.copy(shoulderRotation).multiply(forearm.quaternion);
  inverse.copy(elbowRotation).invert();
  wristDirection.copy(wrist).sub(elbow).normalize().applyQuaternion(inverse);
  adjustment.setFromUnitVectors(arm.elbowAxis, wristDirection);
  forearm.quaternion.multiply(adjustment);
  hand.quaternion.copy(elbowRotation.multiply(adjustment).invert()).multiply(wristRotation);
}

export function loadAvatar(): Promise<AvatarAsset> {
  return new GLTFLoader().loadAsync(asset('table3d/player.glb'));
}

export function createAvatar(asset: AvatarAsset, appearance: Appearance): TableAvatar {
  const object = new THREE.Group();
  const model = clone(asset.scene);
  object.add(model);
  const materials = new Map<THREE.Material, THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  const meshes: THREE.Mesh[] = [];
  const ownMaterial = (material: THREE.Material) => {
    let copy = materials.get(material);
    if (!copy) {
      copy = material.clone();
      materials.set(material, copy);
    }
    return copy;
  };
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes.push(node);
    node.material = Array.isArray(node.material)
      ? node.material.map(ownMaterial)
      : ownMaterial(node.material);
    node.receiveShadow = true;
    node.castShadow = true;
    if (node instanceof THREE.SkinnedMesh) {
      node.frustumCulled = false;
      skeletons.add(node.skeleton);
    }
  });
  const variants = Object.fromEntries(
    Object.entries(partNames).map(([key, names]) => [
      key,
      names.map((name) => model.getObjectByName(name)),
    ]),
  ) as Record<keyof typeof partNames, (THREE.Object3D | undefined)[]>;
  let firstPerson = false;
  let currentAppearance = appearance;
  const applyAppearance = (next: Appearance) => {
    for (const mesh of meshes) {
      mesh.visible = !firstPerson || mesh.name === 'Arms' || mesh.parent?.name === 'Arms';
    }
    for (const [part, nodes] of Object.entries(variants) as [
      keyof typeof partNames,
      typeof variants.base,
    ][]) {
      for (const [index, node] of nodes.entries()) {
        if (node)
          node.visible = !firstPerson && (part === 'body' ? next.base : next[part]) === index;
      }
    }
    for (const material of materials.values()) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.name === 'Skin') material.color.setHex(skinColors[next.skin] ?? skinColors[1]);
      if (material.name === 'Nail')
        material.color.setHex(skinColors[next.skin] ?? skinColors[1]).lerp(nailHighlight, 0.31);
      if (material.name === 'Shirt') material.color.setHex(shirts[next.shirt] ?? shirts[0]);
      if (material.name === 'Hair') material.color.setHex(hairColors[next.base] ?? hairColors[0]);
    }
  };
  applyAppearance(appearance);

  const head = model.getObjectByName('Head');
  const jaw = model.getObjectByName('Jaw');
  const leftEye = model.getObjectByName('EyeL') ?? model.getObjectByName('Eye.L');
  const rightEye = model.getObjectByName('EyeR') ?? model.getObjectByName('Eye.R');
  const tongue = model.getObjectByName('Tongue');
  const arms = [bindArm(model, 'L'), bindArm(model, 'R')].filter((arm) => arm !== undefined);
  const tongueBase = tongue?.position.x ?? 0;
  const leftScale = leftEye?.scale.y ?? 1;
  const rightScale = rightEye?.scale.y ?? 1;
  if (tongue) tongue.scale.setScalar(0);
  const headBase = head?.quaternion.clone();
  const jawBase = jaw?.quaternion.clone();
  const look = new THREE.Euler(0, 0, 0, 'YXZ');
  const rotation = new THREE.Quaternion();
  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map(asset.animations.map((clip) => [clip.name.toLowerCase(), clip]));
  const idleClip = clips.get('idle');
  const idle = idleClip && mixer.clipAction(idleClip).play();
  let action: THREE.AnimationAction | undefined;
  let clipName = '';
  let actionTime = 0;
  let signalTime = 0;
  let expression = '';
  let openness = 0;
  let snapGrip = true;
  let sharedSupport = 0;
  const sharedGrip: CardGrip = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, index: -1, amount: 0 };

  function play(name: string, duration?: number) {
    const clip = clips.get(name);
    if (!clip || name === 'idle') return;
    const next = mixer.clipAction(clip);
    if (action && next !== action) action.fadeOut(0.12);
    idle?.fadeOut(0.12);
    next.reset().setEffectiveWeight(1).setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    if (duration) next.setDuration(duration);
    else next.setEffectiveTimeScale(1);
    next.fadeIn(0.12).play();
    action = next;
    clipName = name;
    actionTime = duration ?? clip.duration;
  }

  return {
    object,
    setAppearance(next) {
      const previous = currentAppearance;
      if (
        next.base === previous.base &&
        next.hair === previous.hair &&
        next.hat === previous.hat &&
        next.glasses === previous.glasses &&
        next.skin === previous.skin &&
        next.shirt === previous.shirt
      )
        return;
      currentAppearance = next;
      applyAppearance(next);
    },
    play,
    firstPerson(enabled) {
      if (firstPerson === enabled) return;
      firstPerson = enabled;
      applyAppearance(currentAppearance);
    },
    resetGrip() {
      mixer.stopAllAction();
      idle?.reset().setEffectiveWeight(1).play();
      action = undefined;
      clipName = '';
      signalTime = 0;
      snapGrip = true;
    },
    update(dt, pose, mouth = 0, grips, animate = true) {
      // Restore the tracks' base before the mixer so procedural deltas never accumulate.
      if (head && headBase) head.quaternion.copy(headBase);
      if (jaw && jawBase) jaw.quaternion.copy(jawBase);
      for (const { joints } of arms)
        for (const { node, base } of joints) node.quaternion.copy(base);
      if (action && (actionTime -= dt) <= 0) {
        action.fadeOut(0.16);
        idle?.reset().fadeIn(0.16).play();
        action = undefined;
        clipName = '';
      }
      mixer.update(animate ? dt : 0);
      const releasing = clipName === 'play' || clipName === 'fold' || clipName === 'deal';
      const brace = releasing && grips?.left.amount && grips.right.amount ? 1 : 0;
      const snap = snapGrip || !animate;
      sharedSupport = snap ? brace : damp(sharedSupport, brace, dt, 30);
      let leftGrip = grips?.left;
      if (grips && sharedSupport > 0.002 && leftGrip?.amount && grips.right.amount) {
        const { left, right } = grips;
        // Hold the overlapping lower corners with the left thumb while the
        // other hand is busy placing or dealing a card.
        const y = (left.y + right.y) / 2 - 0.006 * Math.cos(left.pitch);
        const z = (left.z + right.z) / 2 - 0.006 * Math.sin(left.pitch);
        sharedGrip.x = THREE.MathUtils.lerp(left.x, (left.x + right.x) / 2, sharedSupport);
        sharedGrip.y = THREE.MathUtils.lerp(left.y, y, sharedSupport);
        sharedGrip.z = THREE.MathUtils.lerp(left.z, z, sharedSupport);
        sharedGrip.roll = left.roll * (1 - sharedSupport);
        sharedGrip.pitch = left.pitch;
        sharedGrip.index = left.index;
        sharedGrip.amount = left.amount;
        leftGrip = sharedGrip;
      }
      for (const arm of arms) {
        for (const { node, base } of arm.joints) base.copy(node.quaternion);
        const left = arm.side === 'L';
        const gesture = !!clipName && clipName !== 'fan' && clipName !== 'draw';
        const grip = left ? leftGrip : grips?.right;
        poseArm(arm, object, grip, gesture && (!grip?.amount || (!left && releasing)), dt, snap);
      }
      snapGrip = false;
      if (head && headBase) {
        headBase.copy(head.quaternion);
        if (pose)
          head.quaternion.multiply(rotation.setFromEuler(look.set(pose.pitch, pose.yaw, 0)));
      }
      if (jaw && jawBase) {
        jawBase.copy(jaw.quaternion);
        openness = damp(openness, mouth, dt, 19);
        jaw.quaternion.multiply(rotation.setFromEuler(look.set(openness * 0.32, 0, 0)));
      }
      if (signalTime > 0) signalTime = Math.max(0, signalTime - dt);
      if (leftEye)
        leftEye.scale.y =
          leftScale * (signalTime && ['perica', 'receta'].includes(expression) ? 0.12 : 1);
      if (rightEye)
        rightEye.scale.y =
          rightScale * (signalTime && ['perico', 'receta'].includes(expression) ? 0.12 : 1);
      if (tongue) {
        const showing = signalTime > 0 && ['seven_spades', 'seven_coins'].includes(expression);
        tongue.scale.setScalar(showing ? 1 : 0);
        tongue.position.x = tongueBase + (expression === 'seven_spades' ? -0.035 : 0.035);
      }
    },
    signal(kind) {
      expression = kind;
      signalTime = 0.65;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const material of materials.values()) material.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
      object.removeFromParent();
    },
  };
}

export function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const property of Object.values(material)) {
          if (property instanceof THREE.Texture) textures.add(property);
        }
      }
    }
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
