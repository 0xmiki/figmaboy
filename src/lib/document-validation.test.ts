import { describe, expect, it } from "vitest";
import { sanitizeDocument } from "$lib/document-validation";

describe("document recovery", () => {
  it("repairs malformed geometry, references, cycles, paints and viewport values", () => {
    const { document, recovered } = sanitizeDocument({
      schemaVersion: 99,
      rootIds: ["frame", "missing"],
      nodes: {
        frame: { id: "wrong", type: "frame", name: "Frame", parentId: null, x: 50, y: 40, width: -100, height: -80, childIds: ["rect", "missing", "rect"], fill: { type: "wat" }, customFutureField: "kept" },
        rect: { id: "rect", type: "rectangle", name: "Card", parentId: "frame", x: Number.NaN, y: 10, width: 30, height: 20, opacity: 4 },
        first: { id: "first", type: "group", parentId: "second", childIds: ["second"] },
        second: { id: "second", type: "group", parentId: "first", childIds: ["first"] },
        unsupported: { id: "unsupported", type: "video" },
      },
      viewport: { x: Number.POSITIVE_INFINITY, y: 20, zoom: 100 },
      prototypeStartFrameId: "rect",
    });

    expect(recovered).toBe(true);
    expect(document.schemaVersion).toBe(1);
    expect(document.nodes.unsupported).toBeUndefined();
    expect(document.nodes.frame).toMatchObject({ id: "frame", x: -50, y: -40, width: 100, height: 80, customFutureField: "kept" });
    expect(document.nodes.rect).toMatchObject({ parentId: "frame", x: 0, opacity: 1 });
    expect((document.nodes.frame as { childIds: string[] }).childIds).toEqual(["rect"]);
    expect(document.viewport).toMatchObject({ x: 0, y: 20, zoom: 8 });
    expect(document.prototypeStartFrameId).toBeNull();

    const cycleStillExists = document.nodes.first.parentId === "second" && document.nodes.second.parentId === "first";
    expect(cycleStillExists).toBe(false);
  });
});
