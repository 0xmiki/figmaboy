import { describe, expect, it } from "vitest";
import { createLiveBounds, createRenderBounds, shouldRefreshRenderBounds, visibleWorldRect } from "$lib/editor/canvas-culling";

describe("canvas culling window", () => {
  const size = { width: 1000, height: 800 };

  it("keeps one viewport of retained content around the live view", () => {
    expect(createRenderBounds({ x: 0, y: 0, zoom: 1 }, size)).toEqual({ x: -1000, y: -800, width: 3000, height: 2400 });
    expect(createLiveBounds({ x: 0, y: 0, zoom: 1 }, size)).toEqual({ x: -500, y: -400, width: 2000, height: 1600 });
    expect(visibleWorldRect({ x: -3000, y: -1600, zoom: 2 }, size)).toEqual({ x: 1500, y: 800, width: 500, height: 400 });
  });

  it("biases the retained window toward travel without shrinking it", () => {
    expect(createRenderBounds({ x: 0, y: 0, zoom: 1 }, size, { x: 1, y: 0 })).toEqual({ x: -500, y: -800, width: 3000, height: 2400 });
    expect(createRenderBounds({ x: 0, y: 0, zoom: 1 }, size, { x: -1, y: 1 })).toEqual({ x: -1500, y: -400, width: 3000, height: 2400 });
  });

  it("uses hysteresis but refreshes before a fast pan outruns mounted nodes", () => {
    const anchor = { x: 0, y: 0, zoom: 1 };
    const bounds = createRenderBounds(anchor, size);
    expect(shouldRefreshRenderBounds(bounds, anchor.zoom, { x: -300, y: -200, zoom: 1 }, size)).toBe(false);
    expect(shouldRefreshRenderBounds(bounds, anchor.zoom, { x: -900, y: -700, zoom: 1 }, size)).toBe(true);
    expect(shouldRefreshRenderBounds(bounds, anchor.zoom, { x: -3000, y: 0, zoom: 1 }, size)).toBe(true);
  });

  it("refreshes when zoom makes the retained window disproportionately large or small", () => {
    const bounds = createRenderBounds({ x: 0, y: 0, zoom: 1 }, size);
    expect(shouldRefreshRenderBounds(bounds, 1, { x: 0, y: 0, zoom: 1.5 }, size)).toBe(false);
    expect(shouldRefreshRenderBounds(bounds, 1, { x: 0, y: 0, zoom: 2.1 }, size)).toBe(true);
    expect(shouldRefreshRenderBounds(bounds, 1, { x: 0, y: 0, zoom: .49 }, size)).toBe(true);
  });
});
