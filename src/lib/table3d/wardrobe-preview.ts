import { asset } from '$app/paths';
import type { Appearance } from '#lib/appearance.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createAvatar,
  disposeScene,
  loadAvatar,
  type AvatarAsset,
  type TableAvatar,
} from './avatar.js';
import { seatDistance } from './camera.js';
import { lightTableRoom } from './lighting.js';

export class WardrobePreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(39, 1, 0.05, 12);
  private readonly observer: ResizeObserver;
  private readonly controller = new AbortController();
  private room?: THREE.Group;
  private asset?: AvatarAsset;
  private avatar?: TableAvatar;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private appearance: Appearance,
    private readonly status: (state: 'ready' | 'unavailable') => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    lightTableRoom(this.scene, this.renderer);
    this.camera.position.set(0.15, 1.48, 0.91);
    this.camera.lookAt(0, 1.16, -seatDistance);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(canvas);
    void this.load();
  }

  setAppearance(appearance: Appearance) {
    this.appearance = appearance;
    this.avatar?.setAppearance(appearance);
    this.render();
  }

  private async load() {
    const roomPath = asset('table3d/room.glb');
    const room = fetch(roomPath, { signal: this.controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Room asset unavailable');
      return new GLTFLoader().parseAsync(
        await response.arrayBuffer(),
        THREE.LoaderUtils.extractUrlBase(roomPath),
      );
    });
    const [loadedRoom, loadedAvatar] = await Promise.allSettled([room, loadAvatar()]);
    if (loadedRoom.status === 'fulfilled') this.room = loadedRoom.value.scene;
    if (loadedAvatar.status === 'fulfilled') this.asset = loadedAvatar.value;
    if (this.disposed || !this.room || !this.asset) {
      this.releaseMeshes();
      if (!this.disposed) this.fail();
      return;
    }
    try {
      this.avatar = createAvatar(this.asset, this.appearance);
      this.avatar.object.position.z = -seatDistance;
      this.avatar.update(0, undefined, 0, undefined, false);
      this.scene.add(this.room, this.avatar.object);
      this.render();
      if (!this.disposed) this.status('ready');
    } catch {
      this.fail();
    }
  }

  private render() {
    if (this.disposed || !this.avatar) return;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    try {
      this.renderer.setSize(width, height, false);
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.fail();
    }
  }

  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.fail();
  };

  private fail() {
    this.dispose();
    this.status('unavailable');
  }

  private releaseMeshes() {
    this.avatar?.dispose();
    this.avatar = undefined;
    if (this.room) {
      this.room.removeFromParent();
      disposeScene(this.room);
      this.room = undefined;
    }
    if (this.asset) {
      disposeScene(this.asset.scene);
      this.asset = undefined;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.releaseMeshes();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
