import type { DesignNode, PageDocument, Rect } from "$lib/domain";
import { identity, intersects, multiply, nodeMatrix, transformPoint, type Matrix } from "$lib/geometry";

export interface CanvasSceneEntry {
  id: string;
  parentId: string | null;
  bounds: Rect;
  subtreeSize: number;
}

interface SceneBranch {
  bounds: Rect;
  left?: SceneBranch;
  right?: SceneBranch;
  entries?: CanvasSceneEntry[];
}

export interface CanvasSceneIndex {
  entries: ReadonlyMap<string, CanvasSceneEntry>;
  parents: ReadonlyMap<string, string | null>;
  root: SceneBranch | null;
  count: number;
}

const leafSize = 12;

function matrixBounds(matrix: Matrix, node: DesignNode): Rect {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: node.width, y: 0 }),
    transformPoint(matrix, { x: node.width, y: node.height }),
    transformPoint(matrix, { x: 0, y: node.height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function unionBounds(entries: Array<{ bounds: Rect }>): Rect {
  const left = Math.min(...entries.map((entry) => entry.bounds.x));
  const top = Math.min(...entries.map((entry) => entry.bounds.y));
  const right = Math.max(...entries.map((entry) => entry.bounds.x + entry.bounds.width));
  const bottom = Math.max(...entries.map((entry) => entry.bounds.y + entry.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function intersection(left: Rect | null, right: Rect): Rect | null {
  if (!left) return right;
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const edgeX = Math.min(left.x + left.width, right.x + right.width);
  const edgeY = Math.min(left.y + left.height, right.y + right.height);
  return edgeX >= x && edgeY >= y ? { x, y, width: edgeX - x, height: edgeY - y } : null;
}

function buildBranch(entries: CanvasSceneEntry[]): SceneBranch | null {
  if (!entries.length) return null;
  const bounds = unionBounds(entries);
  if (entries.length <= leafSize) return { bounds, entries };
  const horizontal = bounds.width >= bounds.height;
  const sorted = entries.toSorted((left, right) => {
    const leftCenter = horizontal ? left.bounds.x + left.bounds.width / 2 : left.bounds.y + left.bounds.height / 2;
    const rightCenter = horizontal ? right.bounds.x + right.bounds.width / 2 : right.bounds.y + right.bounds.height / 2;
    return leftCenter - rightCenter;
  });
  const middle = Math.ceil(sorted.length / 2);
  return { bounds, left: buildBranch(sorted.slice(0, middle)) ?? undefined, right: buildBranch(sorted.slice(middle)) ?? undefined };
}

export function buildCanvasSceneIndex(document: PageDocument): CanvasSceneIndex {
  const entries = new Map<string, CanvasSceneEntry>();
  const parents = new Map<string, string | null>();
  const visit = (id: string, parentMatrix: Matrix, clipBounds: Rect | null): number => {
    const node = document.nodes[id];
    if (!node || !node.visible) return 0;
    parents.set(id, node.parentId);
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    const rawBounds = matrixBounds(matrix, node);
    const visibleBounds = intersection(clipBounds, rawBounds);
    const entry = visibleBounds ? { id, parentId: node.parentId, bounds: visibleBounds, subtreeSize: 1 } : null;
    if (entry) entries.set(id, entry);
    if (node.type !== "frame" && node.type !== "group") return 1;
    const childClip = node.type === "frame" && node.clipContent ? visibleBounds : clipBounds;
    if (node.type === "frame" && node.clipContent && !childClip) return 1;
    const subtreeSize = 1 + node.childIds.reduce((total, childId) => total + visit(childId, matrix, childClip), 0);
    if (entry) entry.subtreeSize = subtreeSize;
    return subtreeSize;
  };
  document.rootIds.forEach((id) => visit(id, identity, null));
  const values = [...entries.values()];
  return { entries, parents, root: buildBranch(values), count: values.length };
}

function queryBranch(branch: SceneBranch | null, bounds: Rect, result: Set<string>): void {
  if (!branch || !intersects(branch.bounds, bounds)) return;
  if (branch.entries) {
    branch.entries.forEach((entry) => { if (intersects(entry.bounds, bounds)) result.add(entry.id); });
    return;
  }
  queryBranch(branch.left ?? null, bounds, result);
  queryBranch(branch.right ?? null, bounds, result);
}

export function queryCanvasScene(index: CanvasSceneIndex, bounds: Rect, into = new Set<string>()): Set<string> {
  queryBranch(index.root, bounds, into);
  for (const id of [...into]) {
    let parentId = index.parents.get(id) ?? null;
    while (parentId) {
      into.add(parentId);
      parentId = index.parents.get(parentId) ?? null;
    }
  }
  return into;
}
