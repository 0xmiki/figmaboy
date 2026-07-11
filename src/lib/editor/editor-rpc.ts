import type { DesignNode, ImportedAsset, NodeType, PageDocument, Rect } from "$lib/domain";
import { cloneDocument, defaultNode } from "$lib/domain";
import type { EditorSession } from "$lib/editor/editor.svelte";
import { selectionBounds, transformPoint, worldBounds, worldMatrix, worldToNodeLocal } from "$lib/geometry";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of IDs`);
  return value as string[];
}

function checkChangeToken(session: EditorSession, params: JsonObject): void {
  if (typeof params.expectedChangeToken === "number" && params.expectedChangeToken !== session.changeToken) {
    throw new Error(`STALE_DOCUMENT: expected changeToken ${params.expectedChangeToken}, current value is ${session.changeToken}`);
  }
}

function removeFromParent(document: PageDocument, node: DesignNode): void {
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  const list = parent && (parent.type === "frame" || parent.type === "group") ? parent.childIds : document.rootIds;
  const index = list.indexOf(node.id);
  if (index >= 0) list.splice(index, 1);
}

function insertIntoParent(document: PageDocument, node: DesignNode, parentId: string | null, index?: number): void {
  const parent = parentId ? document.nodes[parentId] : null;
  if (parentId && parent?.type !== "frame" && parent?.type !== "group") throw new Error(`Parent ${parentId} is not a container`);
  node.parentId = parentId;
  const list = parent && (parent.type === "frame" || parent.type === "group") ? parent.childIds : document.rootIds;
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, node.id);
}

function removeTree(document: PageDocument, id: string): void {
  const node = document.nodes[id];
  if (!node) return;
  if (node.type === "frame" || node.type === "group") [...node.childIds].forEach((child) => removeTree(document, child));
  removeFromParent(document, node);
  delete document.nodes[id];
}

const NODE_TYPES = new Set<NodeType>(["frame", "group", "rectangle", "ellipse", "line", "arrow", "polygon", "star", "text", "image", "icon"]);
const PAINT_TYPES = new Set(["solid", "linear-gradient", "radial-gradient"]);
const BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);

function finite(value: unknown, label: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  if (minimum !== undefined && value < minimum) throw new Error(`${label} must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) throw new Error(`${label} must be at most ${maximum}`);
  return value;
}

function validatePaint(value: unknown, label: string): void {
  if (value === null) return;
  const paint = object(value, label);
  if (typeof paint.type !== "string" || !PAINT_TYPES.has(paint.type)) throw new Error(`${label}.type is unsupported`);
  if (paint.type === "solid") {
    if (typeof paint.color !== "string") throw new Error(`${label}.color must be a CSS color`);
    finite(paint.opacity, `${label}.opacity`, 0, 1);
    return;
  }
  if (!Array.isArray(paint.stops) || paint.stops.length < 2) throw new Error(`${label}.stops must contain at least two color stops`);
  paint.stops.forEach((value, index) => {
    const stop = object(value, `${label}.stops[${index}]`);
    finite(stop.offset, `${label}.stops[${index}].offset`, 0, 1);
    finite(stop.opacity, `${label}.stops[${index}].opacity`, 0, 1);
    if (typeof stop.color !== "string") throw new Error(`${label}.stops[${index}].color must be a CSS color`);
  });
  if (paint.type === "linear-gradient") finite(paint.angle, `${label}.angle`);
  else {
    finite(paint.centerX, `${label}.centerX`);
    finite(paint.centerY, `${label}.centerY`);
    finite(paint.radius, `${label}.radius`, 0);
  }
}

function validateStyle(node: DesignNode): void {
  validatePaint(node.fill, `Node ${node.id} fill`);
  if (node.blendMode !== undefined && !BLEND_MODES.has(node.blendMode)) throw new Error(`Node ${node.id} has an unsupported blendMode`);
  finite(node.radius, `Node ${node.id} radius`, 0);
  if (node.cornerRadii) Object.values(node.cornerRadii).forEach((value) => finite(value, `Node ${node.id} corner radius`, 0));
  if (node.stroke) {
    finite(node.stroke.opacity, `Node ${node.id} stroke opacity`, 0, 1);
    finite(node.stroke.width, `Node ${node.id} stroke width`, 0);
    node.stroke.dash?.forEach((value) => finite(value, `Node ${node.id} stroke dash`, 0));
  }
  for (const effect of node.effects ?? []) {
    if (effect.type === "layer-blur") finite(effect.radius, `Node ${node.id} layer blur`, 0);
    else if (effect.type === "drop-shadow") {
      finite(effect.opacity, `Node ${node.id} shadow opacity`, 0, 1);
      finite(effect.x, `Node ${node.id} shadow x`);
      finite(effect.y, `Node ${node.id} shadow y`);
      finite(effect.blur, `Node ${node.id} shadow blur`, 0);
    } else throw new Error(`Node ${node.id} has an unsupported effect`);
  }
  if (node.type === "text") {
    finite(node.fontSize, `Node ${node.id} fontSize`, 1);
    finite(node.fontWeight, `Node ${node.id} fontWeight`, 1, 1000);
    finite(node.lineHeight, `Node ${node.id} lineHeight`, .1);
    finite(node.letterSpacing, `Node ${node.id} letterSpacing`);
    if (node.paragraphSpacing !== undefined) finite(node.paragraphSpacing, `Node ${node.id} paragraphSpacing`, 0);
    if (node.paragraphIndent !== undefined) finite(node.paragraphIndent, `Node ${node.id} paragraphIndent`, 0);
    if (node.maxLines !== null && node.maxLines !== undefined) finite(node.maxLines, `Node ${node.id} maxLines`, 1);
  }
}

function validateDocument(document: PageDocument): void {
  const listed = new Set<string>();
  const visit = (id: string, parentId: string | null, ancestors: Set<string>) => {
    const node = document.nodes[id];
    if (!node) throw new Error(`Missing node ${id}`);
    if (listed.has(id)) throw new Error(`Node ${id} appears more than once in the layer tree`);
    if (ancestors.has(id)) throw new Error(`Layer cycle detected at ${id}`);
    if (node.parentId !== parentId) throw new Error(`Node ${id} has an inconsistent parentId`);
    for (const value of [node.x, node.y, node.width, node.height, node.rotation, node.opacity]) {
      if (!Number.isFinite(value)) throw new Error(`Node ${id} has a non-finite numeric value`);
    }
    if (node.width < 0 || node.height < 0 || node.width > 100_000 || node.height > 100_000) throw new Error(`Node ${id} has invalid dimensions`);
    if (node.opacity < 0 || node.opacity > 1) throw new Error(`Node ${id} opacity must be between 0 and 1`);
    validateStyle(node);
    listed.add(id);
    if (node.type === "frame" || node.type === "group") {
      const next = new Set(ancestors); next.add(id);
      node.childIds.forEach((child) => visit(child, id, next));
    }
  };
  document.rootIds.forEach((id) => visit(id, null, new Set()));
  const unlisted = Object.keys(document.nodes).filter((id) => !listed.has(id));
  if (unlisted.length) throw new Error(`Nodes are missing from the layer tree: ${unlisted.join(", ")}`);
}

function applyOperation(document: PageDocument, operationValue: unknown, createdIds: string[]): void {
  const operation = object(operationValue, "operation");
  const kind = operation.kind;
  if (kind === "create") {
    const spec = object(operation.node, "create.node");
    const type = spec.type;
    if (typeof type !== "string" || !NODE_TYPES.has(type as NodeType)) throw new Error(`Unsupported node type: ${String(type)}`);
    const x = typeof spec.x === "number" ? spec.x : 0;
    const y = typeof spec.y === "number" ? spec.y : 0;
    const node = defaultNode(type as NodeType, x, y, spec as Partial<DesignNode>);
    if (document.nodes[node.id]) throw new Error(`Node ID already exists: ${node.id}`);
    if (node.type === "frame" || node.type === "group") node.childIds = [];
    document.nodes[node.id] = node;
    insertIntoParent(document, node, typeof operation.parentId === "string" ? operation.parentId : null, typeof operation.index === "number" ? operation.index : undefined);
    createdIds.push(node.id);
    return;
  }
  if (kind === "update") {
    if (typeof operation.id !== "string") throw new Error("update.id is required");
    const node = document.nodes[operation.id];
    if (!node) throw new Error(`Unknown node ${operation.id}`);
    const patch = object(operation.patch, "update.patch");
    for (const forbidden of ["id", "type", "parentId", "childIds"]) if (forbidden in patch) throw new Error(`Use a dedicated operation instead of updating ${forbidden}`);
    Object.assign(node, patch);
    if (node.type === "text") {
      if ("autoWidth" in patch && !("textAutoResize" in patch)) node.textAutoResize = node.autoWidth ? "width-and-height" : "height";
      if ("textAutoResize" in patch) node.autoWidth = node.textAutoResize === "width-and-height";
    }
    return;
  }
  if (kind === "delete") {
    strings(operation.ids, "delete.ids").forEach((id) => removeTree(document, id));
    return;
  }
  if (kind === "reparent") {
    const ids = strings(operation.ids, "reparent.ids");
    const parentId = typeof operation.parentId === "string" ? operation.parentId : null;
    ids.forEach((id, offset) => {
      const node = document.nodes[id];
      if (!node) throw new Error(`Unknown node ${id}`);
      removeFromParent(document, node);
      insertIntoParent(document, node, parentId, typeof operation.index === "number" ? operation.index + offset : undefined);
    });
    return;
  }
  if (kind === "reorder") {
    const ids = strings(operation.ids, "reorder.ids");
    const parentId = typeof operation.parentId === "string" ? operation.parentId : null;
    const parent = parentId ? document.nodes[parentId] : null;
    const list = parent && (parent.type === "frame" || parent.type === "group") ? parent.childIds : document.rootIds;
    if (ids.length !== list.length || new Set(ids).size !== ids.length || ids.some((id) => !list.includes(id))) throw new Error("reorder.ids must be a complete permutation of the current siblings");
    list.splice(0, list.length, ...ids);
    return;
  }
  throw new Error(`Unsupported operation kind: ${String(kind)}`);
}

export function applyExternalOperations(session: EditorSession, paramsValue: unknown) {
  const params = object(paramsValue, "params");
  checkChangeToken(session, params);
  if (!Array.isArray(params.operations) || !params.operations.length) throw new Error("operations must be a non-empty array");
  const candidate = cloneDocument(session.document);
  const createdIds: string[] = [];
  params.operations.forEach((operation) => applyOperation(candidate, operation, createdIds));
  validateDocument(candidate);
  session.replaceDocumentFromExternal(candidate);
  return { changeToken: session.changeToken, createdIds, selectedIds: session.selectedIds };
}

function requestedIds(session: EditorSession, params: JsonObject): string[] {
  const ids = Array.isArray(params.ids) ? strings(params.ids, "ids") : session.selectedIds;
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error("Select or provide at least one node");
  unique.forEach((id) => { if (!session.document.nodes[id]) throw new Error(`Unknown node ${id}`); });
  return unique;
}

function translateByWorldDelta(document: PageDocument, node: DesignNode, dx: number, dy: number): void {
  const origin = worldToNodeLocal(document, node.parentId, { x: 0, y: 0 });
  const delta = worldToNodeLocal(document, node.parentId, { x: dx, y: dy });
  node.x += delta.x - origin.x;
  node.y += delta.y - origin.y;
}

/** Figma-style center alignment used by both the inspector and MCP bridge. */
export function centerNodes(session: EditorSession, paramsValue: unknown) {
  const params = object(paramsValue, "params");
  checkChangeToken(session, params);
  const ids = requestedIds(session, params);
  const axis = params.axis;
  if (axis !== "horizontal" && axis !== "vertical" && axis !== "both") throw new Error("axis must be horizontal, vertical, or both");
  const requestedReference = params.relativeTo ?? "auto";
  if (requestedReference !== "auto" && requestedReference !== "selection" && requestedReference !== "parent") throw new Error("relativeTo must be auto, selection, or parent");
  const relativeTo = requestedReference === "auto" ? (ids.length === 1 ? "parent" : "selection") : requestedReference;
  const candidate = cloneDocument(session.document);
  const selected = new Set(ids);
  for (const id of ids) {
    const node = candidate.nodes[id];
    if (node.locked) throw new Error(`Node ${id} is locked`);
    let parentId = node.parentId;
    while (parentId) {
      if (selected.has(parentId)) throw new Error("Centering a parent and its descendant together is ambiguous");
      parentId = candidate.nodes[parentId]?.parentId ?? null;
    }
  }
  if (relativeTo === "parent") {
    const byParent = new Map<string, string[]>();
    for (const id of ids) {
      const parentId = candidate.nodes[id].parentId;
      const parent = parentId ? candidate.nodes[parentId] : null;
      if (!parentId || !parent || (parent.type !== "frame" && parent.type !== "group")) throw new Error(`Node ${id} has no frame/group parent to center within`);
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), id]);
    }
    for (const [parentId, childIds] of byParent) {
      const childBounds = selectionBounds(candidate, childIds);
      const parentBounds = worldBounds(candidate, candidate.nodes[parentId]);
      if (!childBounds) throw new Error(`Could not calculate child bounds for parent ${parentId}`);
      const dx = parentBounds.x + parentBounds.width / 2 - (childBounds.x + childBounds.width / 2);
      const dy = parentBounds.y + parentBounds.height / 2 - (childBounds.y + childBounds.height / 2);
      childIds.forEach((id) => translateByWorldDelta(candidate, candidate.nodes[id], axis === "vertical" ? 0 : dx, axis === "horizontal" ? 0 : dy));
    }
  } else {
    const bounds = selectionBounds(candidate, ids);
    if (!bounds) throw new Error("Could not calculate selection bounds");
    const targetX = bounds.x + bounds.width / 2;
    const targetY = bounds.y + bounds.height / 2;
    const deltas = ids.map((id) => {
      const bounds = worldBounds(candidate, candidate.nodes[id]);
      return { id, dx: targetX - (bounds.x + bounds.width / 2), dy: targetY - (bounds.y + bounds.height / 2) };
    });
    deltas.forEach(({ id, dx, dy }) => translateByWorldDelta(candidate, candidate.nodes[id], axis === "vertical" ? 0 : dx, axis === "horizontal" ? 0 : dy));
  }
  validateDocument(candidate);
  session.replaceDocumentFromExternal(candidate);
  session.selectedIds = ids;
  return { changeToken: session.changeToken, ids, axis, relativeTo };
}

/** Explicit MCP border-radius operation so rounded UI surfaces are discoverable. */
export function setBorderRadius(session: EditorSession, paramsValue: unknown) {
  const params = object(paramsValue, "params");
  checkChangeToken(session, params);
  const ids = requestedIds(session, params);
  const hasRadius = params.radius !== undefined && params.radius !== null;
  const hasCorners = params.cornerRadii !== undefined && params.cornerRadii !== null;
  if (hasRadius === hasCorners) throw new Error("Provide exactly one of radius or cornerRadii");
  const radius = hasRadius ? finite(params.radius, "radius", 0) : null;
  const cornersValue = hasCorners ? object(params.cornerRadii, "cornerRadii") : null;
  const corners = cornersValue ? {
    topLeft: finite(cornersValue.topLeft, "cornerRadii.topLeft", 0),
    topRight: finite(cornersValue.topRight, "cornerRadii.topRight", 0),
    bottomRight: finite(cornersValue.bottomRight, "cornerRadii.bottomRight", 0),
    bottomLeft: finite(cornersValue.bottomLeft, "cornerRadii.bottomLeft", 0),
  } : null;
  const candidate = cloneDocument(session.document);
  ids.forEach((id) => {
    const node = candidate.nodes[id];
    if (node.locked) throw new Error(`Node ${id} is locked`);
    if (node.type !== "frame" && node.type !== "rectangle" && node.type !== "image") throw new Error(`Node ${id} (${node.type}) does not support border radius`);
    if (radius !== null) { node.radius = radius; node.cornerRadii = undefined; }
    else if (corners) node.cornerRadii = corners;
  });
  validateDocument(candidate);
  session.replaceDocumentFromExternal(candidate);
  session.selectedIds = ids;
  return { changeToken: session.changeToken, ids, radius, cornerRadii: corners };
}

/** Place a persisted generated asset as a native image layer. */
export function placeImageNode(session: EditorSession, asset: ImportedAsset, paramsValue: unknown) {
  const params = object(paramsValue, "params");
  checkChangeToken(session, params);
  const parentId = typeof params.parentId === "string" ? params.parentId : null;
  const parent = parentId ? session.document.nodes[parentId] : null;
  if (parentId && parent?.type !== "frame" && parent?.type !== "group") throw new Error(`Parent ${parentId} is not a container`);
  const placement = params.placement ?? "natural";
  if (placement !== "natural" && placement !== "fill-parent") throw new Error("placement must be natural or fill-parent");
  let x = params.x === undefined || params.x === null ? 0 : finite(params.x, "x");
  let y = params.y === undefined || params.y === null ? 0 : finite(params.y, "y");
  let width = params.width === undefined || params.width === null ? null : finite(params.width, "width", 1, 100_000);
  let height = params.height === undefined || params.height === null ? null : finite(params.height, "height", 1, 100_000);
  if (placement === "fill-parent") {
    if (!parent || (parent.type !== "frame" && parent.type !== "group")) throw new Error("fill-parent placement requires a frame/group parentId");
    x = 0; y = 0; width = parent.width; height = parent.height;
  } else if (width === null && height === null) {
    width = asset.width; height = asset.height;
  } else if (width === null) width = height! * asset.width / asset.height;
  else if (height === null) height = width * asset.height / asset.width;
  const fit = params.fit ?? (placement === "fill-parent" ? "cover" : "contain");
  if (fit !== "fill" && fit !== "contain" && fit !== "cover") throw new Error("fit must be fill, contain, or cover");
  const radius = params.radius === undefined || params.radius === null ? 0 : finite(params.radius, "radius", 0);
  const opacity = params.opacity === undefined || params.opacity === null ? 1 : finite(params.opacity, "opacity", 0, 1);
  const node = {
    ...(typeof params.nodeId === "string" ? { id: params.nodeId } : {}),
    type: "image",
    name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : "Generated image",
    x, y, width, height, opacity, radius, fit,
    assetId: asset.id,
    mime: asset.mime,
    ...(typeof params.blendMode === "string" ? { blendMode: params.blendMode } : {}),
  };
  const result = applyExternalOperations(session, {
    expectedChangeToken: params.expectedChangeToken,
    operations: [{ kind: "create", node, parentId, ...(typeof params.index === "number" ? { index: params.index } : {}) }],
  });
  return { ...result, nodeId: result.createdIds[0], asset: { id: asset.id, mime: asset.mime, width: asset.width, height: asset.height } };
}

export function nodeGeometry(session: EditorSession, ids: string[], canvasRect: Rect) {
  const viewport = session.document.viewport;
  return ids.map((id) => {
    const node = session.document.nodes[id];
    if (!node) throw new Error(`Unknown node ${id}`);
    const matrix = worldMatrix(session.document, node);
    const worldCorners = [
      transformPoint(matrix, { x: 0, y: 0 }), transformPoint(matrix, { x: node.width, y: 0 }),
      transformPoint(matrix, { x: node.width, y: node.height }), transformPoint(matrix, { x: 0, y: node.height }),
    ];
    const canvasCorners = worldCorners.map((point) => ({ x: viewport.x + point.x * viewport.zoom, y: viewport.y + point.y * viewport.zoom }));
    return {
      id,
      localBounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      worldBounds: worldBounds(session.document, node),
      worldCorners,
      canvasCorners,
      clientCorners: canvasCorners.map((point) => ({ x: canvasRect.x + point.x, y: canvasRect.y + point.y })),
    };
  });
}
