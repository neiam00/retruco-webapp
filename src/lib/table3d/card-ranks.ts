import * as THREE from 'three';
import { tableCardNumbers } from './cards.js';
import { cardHeight, cardWidth } from './hand-fan.js';

const capacity = 13; // Three plays per seat plus the vira.
const tileWidth = 72;
const tileHeight = 56;
const tileColumns = 5;
const chipHeight = 12;
const texelsPerPixel = 4;
const printedCapHeight = cardHeight * (12 / 133);
const anchors = [
  [-0.31, 0.36],
  [0.31, -0.36],
  [-0.22, 0.22],
  [0.22, -0.22],
  [0, 0.22],
  [0, -0.22],
  [0, 0],
];
const corners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

interface RankFace {
  object: THREE.Group;
  number: number;
}

function chipWidth(number: number) {
  return number < 10 ? 10 : 16;
}

function makeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = tileWidth * tileColumns;
  canvas.height = tileHeight * 2;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = 'bold 44px Arial, sans-serif';
    context.textAlign = 'center';
    for (const [index, number] of tableCardNumbers.entries()) {
      const x = ((index % tileColumns) + 0.5) * tileWidth;
      const y = (Math.floor(index / tileColumns) + 0.5) * tileHeight;
      const width = chipWidth(number) * texelsPerPixel;
      const height = chipHeight * texelsPerPixel;
      context.fillStyle = '#fffdf5';
      context.fillRect(x - width / 2, y - height / 2, width, height);
      context.fillStyle = '#25180e';
      const text = String(number);
      const ink = context.measureText(text);
      context.fillText(
        text,
        x,
        y + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
      );
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

// Depth in normalized device coordinates is affine across a projected plane.
// Put each upright chip on that plane so the same depth buffer hides it behind
// overlapping cards, hands and the deck.
class ProjectedFace {
  private readonly corners = corners.map(() => new THREE.Vector3());
  private readonly matrix = new THREE.Matrix4();
  private readonly placement = new THREE.Matrix4();
  private readonly viewport = new THREE.Vector2();
  private viewRevision = -1;
  private valid = false;
  private area = 0;
  private depthX = 0;
  private depthY = 0;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  opacity = 0;
  revision = 0;
  anchorIndex = 0;

  anchor(x: number, y: number, point: THREE.Vector3) {
    point.set(x * cardWidth, y * cardHeight, 0).applyMatrix4(this.matrix);
    point.x = ((point.x + 1) * this.viewport.x) / 2;
    point.y = ((point.y + 1) * this.viewport.y) / 2;
    return point;
  }

  update(
    object: THREE.Group,
    projection: THREE.Matrix4,
    viewport: THREE.Vector2,
    viewRevision: number,
  ) {
    // Cards are direct children of the scene. Their local matrix is world space.
    object.updateMatrix();
    if (this.viewRevision === viewRevision && object.matrix.equals(this.placement))
      return this.valid;
    this.viewRevision = viewRevision;
    this.placement.copy(object.matrix);
    this.revision++;
    this.matrix.multiplyMatrices(projection, object.matrix);
    this.viewport.copy(viewport);
    return (this.valid = this.updateProjection());
  }

  private updateProjection() {
    for (const [index, [x, y]] of corners.entries()) {
      const point = this.anchor(x / 2, y / 2, this.corners[index]);
      if (point.z < -1 || point.z > 1) return false;
    }
    const [a, b, c, d] = this.corners;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = d.x - a.x;
    const vy = d.y - a.y;
    const uz = b.z - a.z;
    const vz = d.z - a.z;
    this.area = ux * vy - uy * vx;
    if (Math.abs(this.area) < 1) return false;
    this.minX = Math.min(a.x, b.x, c.x, d.x);
    this.maxX = Math.max(a.x, b.x, c.x, d.x);
    this.minY = Math.min(a.y, b.y, c.y, d.y);
    this.maxY = Math.max(a.y, b.y, c.y, d.y);
    this.depthX = (uz * vy - vz * uy) / this.area;
    this.depthY = (vz * ux - uz * vx) / this.area;
    // The projected width of a stroke may shrink as much as its height.
    const printedSize =
      (Math.abs(this.area) * printedCapHeight) /
      Math.max(Math.hypot(ux, uy) * cardHeight, Math.hypot(vx, vy) * cardWidth);
    this.opacity = this.faceUp ? 1 - THREE.MathUtils.smoothstep(printedSize, 6, 8) : 0;
    return true;
  }

  get faceUp() {
    return this.area > 0;
  }

  depth(x: number, y: number) {
    const a = this.corners[0];
    return a.z + (x - a.x) * this.depthX + (y - a.y) * this.depthY;
  }

  private withinEdges(
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    inside: boolean,
  ) {
    const winding = this.faceUp ? 1 : -1;
    for (let i = 0; i < this.corners.length; i++) {
      const a = this.corners[i];
      const b = this.corners[(i + 1) % this.corners.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = winding * ((y - a.y) * dx - (x - a.x) * dy);
      const radius = Math.abs(dx) * halfHeight + Math.abs(dy) * halfWidth;
      if (distance < (inside ? radius : -radius)) return false;
    }
    return true;
  }

  contains(x: number, y: number, halfWidth: number, halfHeight: number) {
    return this.withinEdges(x, y, halfWidth + 1, halfHeight + 1, true);
  }

  covers(other: ProjectedFace, x: number, y: number, halfWidth: number, halfHeight: number) {
    if (
      x + halfWidth < this.minX ||
      x - halfWidth > this.maxX ||
      y + halfHeight < this.minY ||
      y - halfHeight > this.maxY
    )
      return false;
    const depthVariation =
      Math.abs(this.depthX - other.depthX) * halfWidth +
      Math.abs(this.depthY - other.depthY) * halfHeight;
    return (
      this.depth(x, y) - other.depth(x, y) < depthVariation &&
      this.withinEdges(x, y, halfWidth, halfHeight, false)
    );
  }
}

export class CardRanks {
  private readonly texture = makeTexture();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly position = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
  private readonly uv = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 2), 2);
  private readonly color = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 4).fill(1), 4);
  readonly object = new THREE.Mesh(
    this.geometry,
    new THREE.MeshBasicMaterial({
      map: this.texture,
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  private readonly viewProjection = new THREE.Matrix4();
  private readonly pendingProjection = new THREE.Matrix4();
  private readonly viewport = new THREE.Vector2();
  private viewRevision = 0;
  private readonly projected = new WeakMap<THREE.Group, ProjectedFace>();
  private readonly occluders: ProjectedFace[] = [];
  private readonly candidates: { face: ProjectedFace; number: number }[] = [];
  private readonly point = new THREE.Vector3();
  private readonly vertex = new THREE.Vector3();
  private readonly placements: {
    face: ProjectedFace;
    revision: number;
    anchor: number;
    number: number;
  }[] = [];
  private buffersDirty = false;

  constructor() {
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.uv.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('color', this.color);
    this.geometry.setIndex(
      Array.from({ length: capacity }, (_, i) => {
        const a = i * 4;
        return [a, a + 1, a + 2, a, a + 2, a + 3];
      }).flat(),
    );
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  private project(object: THREE.Group) {
    let face = this.projected.get(object);
    if (!face) {
      face = new ProjectedFace();
      this.projected.set(object, face);
    }
    return face.update(object, this.viewProjection, this.viewport, this.viewRevision)
      ? face
      : undefined;
  }

  update(camera: THREE.Camera, viewport: THREE.Vector2, faces: RankFace[], objects: THREE.Group[]) {
    this.object.visible = false;
    if (!faces.length) return;
    camera.updateMatrixWorld();
    this.pendingProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.viewProjection.equals(this.pendingProjection) || !this.viewport.equals(viewport)) {
      this.viewProjection.copy(this.pendingProjection);
      this.viewport.copy(viewport);
      this.viewRevision++;
    }
    this.candidates.length = 0;
    for (const { object, number } of faces) {
      const face = this.project(object);
      if (face?.opacity) this.candidates.push({ face, number });
    }
    if (!this.candidates.length) return;
    this.occluders.length = 0;
    for (const object of objects) {
      const face = this.project(object);
      if (face) this.occluders.push(face);
    }

    let count = 0;
    for (const { face, number } of this.candidates) {
      if (this.writeRank(face, number, count, camera, viewport)) count++;
    }
    this.object.visible = count > 0;
    this.geometry.setDrawRange(0, count * 6);
    if (this.buffersDirty) {
      this.position.needsUpdate = true;
      this.uv.needsUpdate = true;
      this.color.needsUpdate = true;
      this.buffersDirty = false;
    }
  }

  private writeRank(
    face: ProjectedFace,
    number: number,
    index: number,
    camera: THREE.Camera,
    viewport: THREE.Vector2,
  ) {
    const tile = tableCardNumbers.indexOf(number);
    if (tile < 0 || index >= capacity) return false;
    const width = chipWidth(number);
    const height = chipHeight;
    const uvX = ((tile % tileColumns) + 0.5) * tileWidth;
    const uvY = (Math.floor(tile / tileColumns) + 0.5) * tileHeight;
    const { width: textureWidth, height: textureHeight } = this.texture.image as HTMLCanvasElement;

    for (let offset = 0; offset < anchors.length; offset++) {
      const anchor = (face.anchorIndex + offset) % anchors.length;
      const [x, y] = anchors[anchor];
      const { x: centerX, y: centerY } = face.anchor(x, y, this.point);
      if (
        centerX < width / 2 ||
        centerX > viewport.x - width / 2 ||
        centerY < height / 2 ||
        centerY > viewport.y - height / 2 ||
        !face.contains(centerX, centerY, width / 2, height / 2) ||
        this.occluders.some(
          (other) => other !== face && other.covers(face, centerX, centerY, width / 2, height / 2),
        )
      )
        continue;

      face.anchorIndex = anchor;
      const previous = this.placements[index];
      if (
        previous?.face === face &&
        previous.revision === face.revision &&
        previous.anchor === anchor &&
        previous.number === number
      )
        return true;
      this.placements[index] = { face, revision: face.revision, anchor, number };
      this.buffersDirty = true;
      for (const [corner, [dx, dy]] of corners.entries()) {
        const px = centerX + (dx * width) / 2;
        const py = centerY + (dy * height) / 2;
        this.vertex
          .set((px / viewport.x) * 2 - 1, (py / viewport.y) * 2 - 1, face.depth(px, py))
          .unproject(camera);
        const vertex = index * 4 + corner;
        this.position.setXYZ(vertex, this.vertex.x, this.vertex.y, this.vertex.z);
        this.color.setW(vertex, face.opacity);
        this.uv.setXY(
          vertex,
          (uvX + ((dx * width) / 2) * texelsPerPixel) / textureWidth,
          1 - (uvY - ((dy * height) / 2) * texelsPerPixel) / textureHeight,
        );
      }
      return true;
    }
    return false;
  }

  dispose() {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }
}
