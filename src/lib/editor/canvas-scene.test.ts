import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument, type DesignNode } from "$lib/domain";
import { buildCanvasSceneIndex, queryCanvasScene } from "$lib/editor/canvas-scene";

function add(document: ReturnType<typeof emptyDocument>, node: DesignNode, parentId: string | null = null) {
  node.parentId = parentId;
  document.nodes[node.id] = node;
  if (!parentId) document.rootIds.push(node.id);
  else {
    const parent = document.nodes[parentId];
    if (parent.type === "frame" || parent.type === "group") parent.childIds.push(node.id);
  }
}

describe("canvas scene index", () => {
  it("queries a small viewport without returning the full document", () => {
    const document = emptyDocument();
    for (let index = 0; index < 10_000; index += 1) {
      const node = defaultNode("rectangle", (index % 100) * 120, Math.floor(index / 100) * 120, { width: 80, height: 80 });
      add(document, node);
    }
    const scene = buildCanvasSceneIndex(document);
    const visible = queryCanvasScene(scene, { x: 0, y: 0, width: 500, height: 500 });
    expect(scene.count).toBe(10_000);
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(100);
  });

  it("retains the ancestor chain for visible descendants", () => {
    const document = emptyDocument();
    const frame = defaultNode("frame", 1_000, 1_000, { width: 600, height: 600 });
    const group = defaultNode("group", 100, 100, { width: 300, height: 300 });
    const child = defaultNode("rectangle", 40, 40, { width: 80, height: 80 });
    add(document, frame);
    add(document, group, frame.id);
    add(document, child, group.id);
    const visible = queryCanvasScene(buildCanvasSceneIndex(document), { x: 1_130, y: 1_130, width: 120, height: 120 });
    expect([...visible]).toEqual(expect.arrayContaining([frame.id, group.id, child.id]));
    expect(buildCanvasSceneIndex(document).entries.get(frame.id)?.subtreeSize).toBe(3);
  });

  it("does not index descendants outside a clipping frame", () => {
    const document = emptyDocument();
    const frame = defaultNode("frame", 0, 0, { width: 200, height: 200, clipContent: true });
    const child = defaultNode("rectangle", 400, 400, { width: 80, height: 80 });
    add(document, frame);
    add(document, child, frame.id);
    const scene = buildCanvasSceneIndex(document);
    expect(scene.entries.has(frame.id)).toBe(true);
    expect(scene.entries.has(child.id)).toBe(false);
  });
});
