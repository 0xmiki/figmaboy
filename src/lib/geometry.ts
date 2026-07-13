import type { DesignNode, PageDocument, Rect } from "$lib/domain";

export interface Point { x: number; y: number }
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }
export const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function nodeMatrix(node: DesignNode): Matrix {
  const radians = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = node.width / 2;
  const cy = node.height / 2;
  return { a: cos, b: sin, c: -sin, d: cos, e: node.x + cx - cos * cx + sin * cy, f: node.y + cy - sin * cx - cos * cy };
}

export function worldMatrix(document: PageDocument, node: DesignNode): Matrix {
  const chain: DesignNode[] = [node];
  let parentId = node.parentId;
  while (parentId) {
    const parent = document.nodes[parentId];
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain.reduce((matrix, current) => multiply(matrix, nodeMatrix(current)), identity);
}

export function transformPoint(matrix: Matrix, point: Point): Point {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
}

export function invert(matrix: Matrix): Matrix {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(det) < 0.000001) return identity;
  return {
    a: matrix.d / det, b: -matrix.b / det, c: -matrix.c / det, d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / det,
  };
}

export function worldBounds(document: PageDocument, node: DesignNode): Rect {
  const matrix = worldMatrix(document, node);
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }), transformPoint(matrix, { x: node.width, y: 0 }),
    transformPoint(matrix, { x: node.width, y: node.height }), transformPoint(matrix, { x: 0, y: node.height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionBounds(document: PageDocument, ids: string[]): Rect | null {
  return unionRects(ids.map((id) => document.nodes[id]).filter(Boolean).map((node) => worldBounds(document, node)));
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function containsRect(container: Rect, target: Rect, tolerance = 0): boolean {
  return target.x >= container.x - tolerance
    && target.y >= container.y - tolerance
    && target.x + target.width <= container.x + container.width + tolerance
    && target.y + target.height <= container.y + container.height + tolerance;
}

export function rectContainsPoint(rect: Rect, point: Point, tolerance = 0): boolean {
  return point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
    && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
}

export function normalizeRect(start: Point, end: Point): Rect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function screenToWorld(point: Point, viewport: { x: number; y: number; zoom: number }): Point {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function worldToNodeLocal(document: PageDocument, nodeId: string | null, point: Point): Point {
  if (!nodeId) return point;
  const node = document.nodes[nodeId];
  return node ? transformPoint(invert(worldMatrix(document, node)), point) : point;
}

/** Finds the nearest frame that should own a layer drawn over the hit node. */
export function drawingParentFrame(document: PageDocument, hitId: string | null): string | null {
  let id = hitId;
  while (id) {
    const node = document.nodes[id];
    if (!node) return null;
    if (node.type === "frame") return node.id;
    id = node.parentId;
  }
  return null;
}

export function frameAtPoint(document: PageDocument, point: Point, excludedIds: string[] = []): string | null {
  const excluded = new Set(excludedIds);
  let candidate: string | null = null;

  const isExcluded = (node: DesignNode): boolean => {
    let id: string | null = node.id;
    while (id) {
      if (excluded.has(id)) return true;
      id = document.nodes[id]?.parentId ?? null;
    }
    return false;
  };

  const visit = (ids: string[]) => {
    for (const id of ids) {
      const node = document.nodes[id];
      if (!node || !node.visible) continue;
      if (node.type === "frame" && !node.locked && !isExcluded(node)) {
        const local = transformPoint(invert(worldMatrix(document, node)), point);
        if (local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height) candidate = node.id;
      }
      if (node.type === "frame" || node.type === "group") visit(node.childIds);
    }
  };

  visit(document.rootIds);
  return candidate;
}

export function polygonPoints(width: number, height: number, count: number, innerRatio = 1): string {
  const points: string[] = [];
  const steps = innerRatio < 1 ? count * 2 : count;
  for (let index = 0; index < steps; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / steps;
    const radius = innerRatio < 1 && index % 2 === 1 ? innerRatio : 1;
    points.push(`${width / 2 + Math.cos(angle) * (width / 2) * radius},${height / 2 + Math.sin(angle) * (height / 2) * radius}`);
  }
  return points.join(" ");
}

export function snap(value: number, candidates: number[], threshold: number): { value: number; guide: number | null } {
  let best = value;
  let guide: number | null = null;
  let distance = threshold + 1;
  for (const candidate of candidates) {
    const next = Math.abs(value - candidate);
    if (next < distance && next <= threshold) { distance = next; best = candidate; guide = candidate; }
  }
  return { value: best, guide };
}
