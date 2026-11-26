import * as THREE from 'three';
import { asset } from '$app/paths';
import type { Card } from '#lib/protocol.js';
import { cardHeight, cardWidth } from './hand-fan.js';

const suits = ['coins', 'cups', 'spades', 'clubs'];
const ranks = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const backTile = 40;

export interface TableCard {
  object: THREE.Group;
  face(card?: Card): void;
}

function tileGeometry(index: number) {
  const geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
  const row = Math.floor(index / 8);
  const column = index % 8;
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (column + (4 + uv.getX(i) * 248) / 256) / 8,
      (5 - row + (4 + uv.getY(i) * 376) / 384) / 6,
    );
  }
  return geometry;
}

export function loadCardTexture() {
  return new THREE.TextureLoader().loadAsync(asset('table3d/cards.webp'));
}

export class TableCards {
  private readonly geometry = new Map<number, THREE.PlaneGeometry>();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly atlas: THREE.Texture;

  constructor(atlas: THREE.Texture, low: boolean) {
    this.atlas = atlas;
    if (low) {
      const image = document.createElement('canvas');
      image.width = 1024;
      image.height = 1152;
      const context = image.getContext('2d');
      if (context && atlas.image instanceof HTMLImageElement) {
        context.drawImage(atlas.image, 0, 0, image.width, image.height);
        atlas.image = image;
      }
    }
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = low ? 1 : 4;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  }

  private tile(index: number) {
    let geometry = this.geometry.get(index);
    if (!geometry) {
      geometry = tileGeometry(index);
      this.geometry.set(index, geometry);
    }
    return geometry;
  }

  make(card?: Card): TableCard {
    const object = new THREE.Group();
    const back = new THREE.Mesh(this.tile(backTile), this.material);
    back.rotation.y = Math.PI;
    back.position.z = -0.0005;
    const face = new THREE.Mesh(this.tile(backTile), this.material);
    object.add(face, back);
    const setFace = (card?: Card) => {
      if (card) {
        const suit = suits.indexOf(card.suit);
        const rank = ranks.indexOf(card.number);
        face.geometry = this.tile(suit >= 0 && rank >= 0 ? suit * 10 + rank : backTile);
      } else {
        face.geometry = this.tile(backTile);
      }
    };
    setFace(card);
    return { object, face: setFace };
  }

  dispose() {
    this.atlas.dispose();
    this.material.dispose();
    for (const geometry of this.geometry.values()) geometry.dispose();
  }
}
