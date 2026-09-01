import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import CanvasNode from "$lib/editor/CanvasNode.svelte";

afterEach(cleanup);

describe("canvas frame raster", () => {
  it("replaces a warm frame subtree with one cached image", () => {
    const document = emptyDocument();
    const frame = defaultNode("frame", 100, 120, { width: 800, height: 600 });
    const child = defaultNode("rectangle", 40, 50, { width: 200, height: 100, parentId: frame.id });
    if (frame.type !== "frame") throw new Error("Expected a frame fixture");
    frame.childIds.push(child.id);
    document.nodes[frame.id] = frame;
    document.nodes[child.id] = child;
    document.rootIds.push(frame.id);
    const cached = "data:image/webp;base64,Y2FjaGU=";
    const view = render(CanvasNode, {
      node: frame,
      document,
      selectedIds: [],
      imageSources: {},
      frameRasters: new Map([[frame.id, cached]]),
      rasterizedFrameIds: new Set([frame.id]),
    });
    expect(view.container.querySelector(`[data-node-id='${frame.id}']`)).toBeTruthy();
    expect(view.container.querySelector(`[data-node-id='${child.id}']`)).toBeNull();
    expect(view.container.querySelector("image")?.getAttribute("href")).toBe(cached);
  });
});
