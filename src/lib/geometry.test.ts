import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import { drawingParentFrame, frameAtPoint, intersects, normalizeRect, polygonPoints, selectionBounds, worldBounds, worldToNodeLocal } from "$lib/geometry";

describe("editor geometry", () => {
  it("normalizes reverse drag rectangles", () => {
    expect(normalizeRect({ x: 80, y: 60 }, { x: 20, y: 10 })).toEqual({ x: 20, y: 10, width: 60, height: 50 });
  });

  it("calculates nested world bounds", () => {
    const document = emptyDocument();
    const frame = defaultNode("frame", 100, 200, { width: 300, height: 200 });
    const rectangle = defaultNode("rectangle", 20, 30, { width: 50, height: 40, parentId: frame.id });
    if (frame.type !== "frame") throw new Error("expected a frame");
    frame.childIds.push(rectangle.id);
    document.nodes[frame.id] = frame;
    document.nodes[rectangle.id] = rectangle;
    document.rootIds.push(frame.id);
    expect(worldBounds(document, rectangle)).toMatchObject({ x: 120, y: 230, width: 50, height: 40 });
  });

  it("finds the nearest drawing frame and converts world coordinates to its local space", () => {
    const document = emptyDocument();
    const outer = defaultNode("frame", 100, 200, { width: 400, height: 300 });
    const inner = defaultNode("frame", 30, 40, { width: 200, height: 140, parentId: outer.id });
    const card = defaultNode("rectangle", 10, 15, { width: 80, height: 50, parentId: inner.id });
    if (outer.type !== "frame" || inner.type !== "frame") throw new Error("expected frames");
    outer.childIds.push(inner.id);
    inner.childIds.push(card.id);
    document.nodes = { [outer.id]: outer, [inner.id]: inner, [card.id]: card };
    document.rootIds = [outer.id];

    expect(drawingParentFrame(document, card.id)).toBe(inner.id);
    expect(worldToNodeLocal(document, inner.id, { x: 170, y: 275 })).toEqual({ x: 40, y: 35 });
    expect(frameAtPoint(document, { x: 170, y: 275 })).toBe(inner.id);
    expect(frameAtPoint(document, { x: 110, y: 210 })).toBe(outer.id);
    expect(frameAtPoint(document, { x: 10, y: 10 })).toBeNull();
  });

  it("unions selection bounds and tests intersections", () => {
    const document = emptyDocument();
    const first = defaultNode("rectangle", 0, 0, { width: 20, height: 20 });
    const second = defaultNode("ellipse", 40, 10, { width: 10, height: 30 });
    document.nodes[first.id] = first;
    document.nodes[second.id] = second;
    document.rootIds.push(first.id, second.id);
    expect(selectionBounds(document, [first.id, second.id])).toMatchObject({ x: 0, y: 0, width: 50, height: 40 });
    expect(intersects({ x: 39, y: 9, width: 2, height: 2 }, worldBounds(document, second))).toBe(true);
  });

  it("generates the requested polygon and star vertices", () => {
    expect(polygonPoints(100, 100, 6).split(" ")).toHaveLength(6);
    expect(polygonPoints(100, 100, 5, 0.44).split(" ")).toHaveLength(10);
  });
});
