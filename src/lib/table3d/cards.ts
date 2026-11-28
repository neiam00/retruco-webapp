import * as THREE from 'three';
import { asset } from '$app/paths';
import type { Card } from '#lib/protocol.js';
import { cardHeight, cardThickness, cardWidth } from './hand-fan.js';

const suits = ['coins', 'cups', 'spades', 'clubs'];
const numbers = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const backTile = 40;
const cornerRadius = 0.0063;
const segmentsPerCorner = 3;

export interface TableCard {
  object: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  face(card?: Card): void;
}

const outline = Array.from({ length: 4 }, (_, corner) => {
  const start = (corner * Math.PI) / 2;
  const middle = start + Math.PI / 4;
  const centerX = Math.sign(Math.cos(middle)) * (cardWidth / 2 - cornerRadius);
  const centerY = Math.sign(Math.sin(middle)) * (cardHeight / 2 - cornerRadius);
  return Array.from({ length: segmentsPerCorner + 1 }, (_, step) => {
    const angle = start + (step * Math.PI) / (2 * segmentsPerCorner);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { x: centerX + nx * cornerRadius, y: centerY + ny * cornerRadius, nx, ny };
  });
}).flat();

function tileUV(uv: number[], index: number, u: number, v: number) {
  uv.push(
    ((index % 8) + (4 + u * 248) / 256) / 8,
    (5 - Math.floor(index / 8) + (4 + v * 376) / 384) / 6,
  );
}

function tileGeometry(index: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (const direction of [1, -1]) {
    const tile = direction === 1 ? index : backTile;
    const z = direction === 1 ? 0 : -cardThickness;
    const center = positions.length / 3;
    positions.push(0, 0, z);
    normals.push(0, 0, direction);
    tileUV(uv, tile, 0.5, 0.5);
    for (const [i, { x, y }] of outline.entries()) {
      positions.push(x, y, z);
      normals.push(0, 0, direction);
      tileUV(uv, tile, 0.5 + (direction * x) / cardWidth, 0.5 + y / cardHeight);
      const current = center + 1 + i;
      const next = center + 1 + ((i + 1) % outline.length);
      if (direction === 1) indices.push(center, current, next);
      else indices.push(center, next, current);
    }
  }

  const edgeStart = positions.length / 3;
  for (const [i, { x, y, nx, ny }] of outline.entries()) {
    positions.push(x, y, 0, x, y, -cardThickness);
    normals.push(nx, ny, 0, nx, ny, 0);
    // The unused last atlas tile contains unprinted paper for the cut edge.
    tileUV(uv, 47, 0.5, 0.5);
    tileUV(uv, 47, 0.5, 0.5);
    const current = edgeStart + i * 2;
    const next = edgeStart + ((i + 1) % outline.length) * 2;
    indices.push(current, current + 1, next + 1, current, next + 1, next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function loadCardTexture() {
  return new THREE.TextureLoader().loadAsync(asset('table3d/cards.webp'));
}

export class TableCards {
  private readonly geometry = new Map<number, THREE.BufferGeometry>();
  private readonly material: THREE.MeshLambertMaterial;

  constructor(
    private readonly atlas: THREE.Texture,
    low: boolean,
  ) {
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
    atlas.anisotropy = low ? 4 : 8;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    // Bounced room light brightens the stock and ink together, especially on
    // the hand-facing side where the pendant contributes very little.
    this.material = new THREE.MeshLambertMaterial({
      map: atlas,
      color: new THREE.Color().setScalar(0.32),
      emissiveMap: atlas,
      emissive: 0xffedd8,
      emissiveIntensity: 0.48,
    });
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
    const object = new THREE.Mesh(this.tile(backTile), this.material);
    object.receiveShadow = true;
    const setFace = (card?: Card) => {
      const suit = card ? suits.indexOf(card.suit) : -1;
      const rank = card ? numbers.indexOf(card.number) : -1;
      object.geometry = this.tile(suit >= 0 && rank >= 0 ? suit * numbers.length + rank : backTile);
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
