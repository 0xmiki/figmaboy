import type { Rect } from "$lib/domain";

export type CanvasViewport = { x: number; y: number; zoom: number };
export type CanvasSize = { width: number; height: number };

export function visibleWorldRect(viewport: CanvasViewport, size: CanvasSize): Rect {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
}

export function createLiveBounds(viewport: CanvasViewport, size: CanvasSize): Rect {
  const visible = visibleWorldRect(viewport, size);
  return {
    x: visible.x - visible.width * .5,
    y: visible.y - visible.height * .5,
    width: visible.width * 2,
    height: visible.height * 2,
  };
}

export function createRenderBounds(viewport: CanvasViewport, size: CanvasSize, direction: { x: number; y: number } = { x: 0, y: 0 }): Rect {
  const visible = visibleWorldRect(viewport, size);
  const biasX = Math.max(-1, Math.min(1, direction.x)) * visible.width * .5;
  const biasY = Math.max(-1, Math.min(1, direction.y)) * visible.height * .5;
  return {
    x: visible.x - visible.width + biasX,
    y: visible.y - visible.height + biasY,
    width: visible.width * 3,
    height: visible.height * 3,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function shouldRefreshRenderBounds(bounds: Rect | null, anchorZoom: number, viewport: CanvasViewport, size: CanvasSize): boolean {
  if (!bounds || size.width <= 0 || size.height <= 0 || viewport.zoom <= 0) return true;
  const zoomRatio = viewport.zoom / anchorZoom;
  if (zoomRatio < .5 || zoomRatio > 2) return true;
  const visible = visibleWorldRect(viewport, size);
  const guardX = Math.max(160 / viewport.zoom, visible.width * .35);
  const guardY = Math.max(160 / viewport.zoom, visible.height * .35);
  return !contains(bounds, {
    x: visible.x - guardX,
    y: visible.y - guardY,
    width: visible.width + guardX * 2,
    height: visible.height + guardY * 2,
  });
}
