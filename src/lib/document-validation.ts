import type { DesignNode, PageDocument, Paint, StrokeStyle } from "$lib/domain";
import { defaultNode, emptyDocument } from "$lib/domain";

const nodeTypes = new Set<DesignNode["type"]>([
  "frame", "group", "rectangle", "ellipse", "line", "arrow", "polygon", "star", "text", "image", "icon",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamped(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function string(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function paint(value: unknown, fallback: Paint | null): Paint | null {
  if (value === null) return null;
  const source = record(value);
  if (!source) return fallback;
  if (source.type === "solid") {
    return { ...source, type: "solid", color: string(source.color, "#000000"), opacity: clamped(source.opacity, 1, 0, 1) } as Paint;
  }
  if (source.type === "linear-gradient" || source.type === "radial-gradient") {
    const stops = Array.isArray(source.stops)
      ? source.stops.flatMap((item) => {
        const stop = record(item);
        return stop ? [{ ...stop, offset: clamped(stop.offset, 0, 0, 1), color: string(stop.color, "#000000"), opacity: clamped(stop.opacity, 1, 0, 1) }] : [];
      })
      : [];
    if (!stops.length) return fallback;
    if (source.type === "linear-gradient") return { ...source, type: source.type, angle: finite(source.angle, 0), stops } as Paint;
    return {
      ...source,
      type: source.type,
      centerX: clamped(source.centerX, .5, 0, 1),
      centerY: clamped(source.centerY, .5, 0, 1),
      radius: clamped(source.radius, .5, .0001, 10),
      stops,
    } as Paint;
  }
  return fallback;
}

function stroke(value: unknown, fallback: StrokeStyle | null): StrokeStyle | null {
  if (value === null) return null;
  const source = record(value);
  if (!source) return fallback;
  const dash = Array.isArray(source.dash) ? source.dash.map((item) => finite(item, 0)).filter((item) => item >= 0) : undefined;
  const cap = source.cap === "butt" || source.cap === "round" || source.cap === "square" ? source.cap : undefined;
  const join = source.join === "miter" || source.join === "round" || source.join === "bevel" ? source.join : undefined;
  return {
    ...source,
    color: string(source.color, "#000000"),
    opacity: clamped(source.opacity, 1, 0, 1),
    width: clamped(source.width, 1, 0, 10000),
    dash,
    cap,
    join,
  };
}

function sanitizeNode(id: string, value: Record<string, unknown>): DesignNode | null {
  if (typeof value.type !== "string" || !nodeTypes.has(value.type as DesignNode["type"])) return null;
  const type = value.type as DesignNode["type"];
  const base = defaultNode(type, finite(value.x, 0), finite(value.y, 0));
  const node = {
    ...base,
    ...value,
    id,
    type,
    name: string(value.name, base.name),
    parentId: typeof value.parentId === "string" ? value.parentId : null,
    x: finite(value.x, base.x),
    y: finite(value.y, base.y),
    width: finite(value.width, base.width),
    height: finite(value.height, base.height),
    rotation: finite(value.rotation, 0),
    opacity: clamped(value.opacity, 1, 0, 1),
    visible: boolean(value.visible, true),
    locked: boolean(value.locked, false),
    fill: paint(value.fill, base.fill),
    stroke: stroke(value.stroke, base.stroke),
    radius: clamped(value.radius, 0, 0, 100000),
  } as DesignNode;

  if (type !== "line" && type !== "arrow") {
    if (node.width < 0) { node.x += node.width; node.width = Math.abs(node.width); }
    if (node.height < 0) { node.y += node.height; node.height = Math.abs(node.height); }
  }
  node.width = Math.min(1_000_000, Math.max(type === "line" || type === "arrow" ? -1_000_000 : 0, node.width));
  node.height = Math.min(1_000_000, Math.max(type === "line" || type === "arrow" ? -1_000_000 : 0, node.height));
  const radii = record(value.cornerRadii);
  node.cornerRadii = radii ? {
    topLeft: clamped(radii.topLeft, node.radius, 0, 100000), topRight: clamped(radii.topRight, node.radius, 0, 100000),
    bottomRight: clamped(radii.bottomRight, node.radius, 0, 100000), bottomLeft: clamped(radii.bottomLeft, node.radius, 0, 100000),
  } : undefined;
  const rawShadow = record(value.shadow);
  node.shadow = rawShadow ? {
    color: string(rawShadow.color, "#000000"), opacity: clamped(rawShadow.opacity, .25, 0, 1),
    x: finite(rawShadow.x, 0), y: finite(rawShadow.y, 4), blur: clamped(rawShadow.blur, 8, 0, 10000),
  } : null;
  const effects: NonNullable<DesignNode["effects"]> = [];
  if (Array.isArray(value.effects)) for (const item of value.effects) {
    const effect = record(item);
    if (effect?.type === "drop-shadow") effects.push({ ...effect, type: effect.type, color: string(effect.color, "#000000"), opacity: clamped(effect.opacity, .25, 0, 1), x: finite(effect.x, 0), y: finite(effect.y, 4), blur: clamped(effect.blur, 8, 0, 10000), visible: boolean(effect.visible, true) });
    if (effect?.type === "layer-blur") effects.push({ ...effect, type: effect.type, radius: clamped(effect.radius, 0, 0, 10000), visible: boolean(effect.visible, true) });
  }
  node.effects = effects;

  if (node.type === "frame" || node.type === "group") {
    node.childIds = Array.isArray(value.childIds) ? value.childIds.filter((child): child is string => typeof child === "string") : [];
    node.clipContent = boolean(value.clipContent, node.type === "frame");
  }
  if (node.type === "text") {
    node.text = string(value.text, "");
    node.fontFamily = string(value.fontFamily, node.fontFamily);
    node.fontSize = clamped(value.fontSize, node.fontSize, 1, 10000);
    node.fontWeight = clamped(value.fontWeight, node.fontWeight, 1, 1000);
    node.fontStyle = value.fontStyle === "italic" ? "italic" : "normal";
    node.lineHeight = clamped(value.lineHeight, node.lineHeight, .1, 20);
    node.letterSpacing = clamped(value.letterSpacing, node.letterSpacing, -10000, 10000);
    node.textAlign = value.textAlign === "center" || value.textAlign === "right" ? value.textAlign : "left";
    node.textAlignVertical = value.textAlignVertical === "center" || value.textAlignVertical === "bottom" ? value.textAlignVertical : "top";
    node.textCase = value.textCase === "upper" || value.textCase === "lower" || value.textCase === "title" ? value.textCase : "original";
    node.textDecoration = value.textDecoration === "underline" || value.textDecoration === "strikethrough" ? value.textDecoration : "none";
    node.textAutoResize = value.textAutoResize === "none" || value.textAutoResize === "height" || value.textAutoResize === "width-and-height"
      ? value.textAutoResize : boolean(value.autoWidth, node.autoWidth) ? "width-and-height" : "height";
    node.paragraphSpacing = clamped(value.paragraphSpacing, 0, 0, 100000);
    node.paragraphIndent = clamped(value.paragraphIndent, 0, 0, 100000);
    node.maxLines = value.maxLines === null || value.maxLines === undefined ? null : Math.max(1, Math.floor(finite(value.maxLines, 1)));
    node.textTruncation = value.textTruncation === "ending" ? "ending" : "disabled";
    node.autoWidth = boolean(value.autoWidth, node.autoWidth);
  }
  if (node.type === "image") {
    node.assetId = string(value.assetId, "");
    node.mime = value.mime === "image/jpeg" || value.mime === "image/webp" ? value.mime : "image/png";
    node.fit = value.fit === "fill" || value.fit === "contain" ? value.fit : "cover";
    const crop = record(value.crop);
    node.crop = crop ? { x: finite(crop.x, 0), y: finite(crop.y, 0), width: clamped(crop.width, 1, 0, 1), height: clamped(crop.height, 1, 0, 1) } : { x: 0, y: 0, width: 1, height: 1 };
  }
  if (node.type === "icon") node.iconName = string(value.iconName, "sparkles");
  return node;
}

/**
 * Converts untrusted saved/imported JSON into a coherent document. Unknown
 * fields on otherwise valid objects are retained so newer files degrade
 * gracefully, while broken references, cycles and invalid numbers are fixed.
 */
export function sanitizeDocument(value: unknown): { document: PageDocument; recovered: boolean } {
  const source = record(value);
  if (!source) return { document: emptyDocument(), recovered: true };
  const rawNodes = record(source.nodes) ?? {};
  const nodes: Record<string, DesignNode> = {};
  for (const [id, rawNode] of Object.entries(rawNodes)) {
    const nodeSource = record(rawNode);
    const node = nodeSource ? sanitizeNode(id, nodeSource) : null;
    if (node) nodes[id] = node;
  }

  // Parent pointers are authoritative. Invalid parents and parent cycles are
  // promoted to roots, then child lists are rebuilt in their previous order.
  for (const node of Object.values(nodes)) {
    const parent = node.parentId ? nodes[node.parentId] : null;
    if (!parent || (parent.type !== "frame" && parent.type !== "group") || parent.id === node.id) node.parentId = null;
  }
  for (const node of Object.values(nodes)) {
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (seen.has(parentId)) { node.parentId = null; break; }
      seen.add(parentId);
      parentId = nodes[parentId]?.parentId ?? null;
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.type !== "frame" && node.type !== "group") continue;
    const ordered = [...new Set(node.childIds)].filter((id) => nodes[id]?.parentId === node.id);
    ordered.push(...Object.values(nodes).filter((child) => child.parentId === node.id && !ordered.includes(child.id)).map((child) => child.id));
    node.childIds = ordered;
  }

  const requestedRoots = Array.isArray(source.rootIds) ? source.rootIds.filter((id): id is string => typeof id === "string") : [];
  const rootIds = [...new Set(requestedRoots)].filter((id) => Boolean(nodes[id]) && nodes[id].parentId === null);
  rootIds.push(...Object.values(nodes).filter((node) => node.parentId === null && !rootIds.includes(node.id)).map((node) => node.id));
  const viewportSource = record(source.viewport) ?? {};
  const prototypeId = typeof source.prototypeStartFrameId === "string" && nodes[source.prototypeStartFrameId]?.type === "frame" ? source.prototypeStartFrameId : null;
  const document = {
    ...source,
    schemaVersion: 1,
    rootIds,
    nodes,
    viewport: {
      ...viewportSource,
      x: finite(viewportSource.x, 0),
      y: finite(viewportSource.y, 0),
      zoom: clamped(viewportSource.zoom, 1, .05, 8),
    },
    prototypeStartFrameId: prototypeId,
  } as PageDocument;

  let recovered = true;
  try { recovered = JSON.stringify(value) !== JSON.stringify(document); } catch { /* cyclic input is recovered */ }
  return { document, recovered };
}
