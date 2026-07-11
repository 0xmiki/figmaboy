import { describe, expect, it } from "vitest";
import { emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { EditorSession } from "$lib/editor/editor.svelte";
import { applyExternalOperations, centerNodes, placeImageNode, setBorderRadius } from "$lib/editor/editor-rpc";

function metadata() {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  return { file, page };
}

function session(): EditorSession {
  const { file, page } = metadata();
  return new EditorSession({ file, pages: [page], page, document: emptyDocument() } satisfies OpenedFile);
}

describe("editor RPC operations", () => {
  it("applies a native layer batch as one undo step", () => {
    const editor = session();
    const result = applyExternalOperations(editor, {
      expectedChangeToken: 0,
      operations: [
        { kind: "create", node: { id: "card", type: "frame", x: 40, y: 60, width: 300, height: 180, name: "Card" } },
        { kind: "create", parentId: "card", node: { id: "title", type: "text", x: 24, y: 24, text: "Hello", name: "Title" } },
      ],
    });
    expect(result.createdIds).toEqual(["card", "title"]);
    expect(editor.document.nodes.card.type).toBe("frame");
    expect(editor.document.nodes.title.parentId).toBe("card");
    editor.undo();
    expect(editor.document.nodes.card).toBeUndefined();
    expect(editor.document.nodes.title).toBeUndefined();
  });

  it("rejects stale edits without modifying the document", () => {
    const editor = session();
    expect(() => applyExternalOperations(editor, { expectedChangeToken: 4, operations: [{ kind: "delete", ids: [] }] })).toThrow("STALE_DOCUMENT");
    expect(editor.document.rootIds).toEqual([]);
  });

  it("accepts rich native styling inside a semantic component tree", () => {
    const editor = session();
    applyExternalOperations(editor, {
      operations: [
        { kind: "create", node: { id: "screen", type: "frame", name: "Landing page", width: 1440, height: 1024 } },
        { kind: "create", parentId: "screen", node: { id: "hero", type: "group", name: "Hero", x: 80, y: 80, width: 1280, height: 480 } },
        { kind: "create", parentId: "hero", node: {
          id: "headline", type: "text", name: "Hero / Headline", text: "Stories, always on.",
          fontFamily: "Georgia, serif", fontSize: 72, fontWeight: 700, fontStyle: "italic",
          textCase: "title", textDecoration: "underline", textAutoResize: "width-and-height",
          fill: { type: "radial-gradient", centerX: .5, centerY: .5, radius: .8, stops: [
            { offset: 0, color: "#ffffff", opacity: 1 }, { offset: 1, color: "#7c3aed", opacity: 1 },
          ] },
          effects: [{ type: "drop-shadow", color: "#000000", opacity: .2, x: 0, y: 12, blur: 32 }],
        } },
      ],
    });
    expect(editor.document.nodes.hero.parentId).toBe("screen");
    expect(editor.document.nodes.headline.parentId).toBe("hero");
    expect(editor.document.nodes.headline.fill?.type).toBe("radial-gradient");
  });

  it("rejects malformed rich paint values atomically", () => {
    const editor = session();
    expect(() => applyExternalOperations(editor, {
      operations: [{ kind: "create", node: { id: "bad", type: "rectangle", fill: { type: "radial-gradient", centerX: .5, centerY: .5, radius: -1, stops: [] } } }],
    })).toThrow("stops must contain at least two");
    expect(editor.document.nodes.bad).toBeUndefined();
  });

  it("centers one layer in its parent like Figma", () => {
    const editor = session();
    applyExternalOperations(editor, { operations: [
      { kind: "create", node: { id: "frame", type: "frame", width: 400, height: 300 } },
      { kind: "create", parentId: "frame", node: { id: "card", type: "rectangle", x: 12, y: 20, width: 100, height: 50 } },
    ] });
    centerNodes(editor, { ids: ["card"], axis: "both" });
    expect(editor.document.nodes.card.x).toBe(150);
    expect(editor.document.nodes.card.y).toBe(125);
    editor.undo();
    expect(editor.document.nodes.card.x).toBe(12);
  });

  it("aligns multiple layer centers to their selection bounds", () => {
    const editor = session();
    applyExternalOperations(editor, { operations: [
      { kind: "create", node: { id: "first", type: "rectangle", x: 0, y: 10, width: 100, height: 40 } },
      { kind: "create", node: { id: "second", type: "rectangle", x: 200, y: 100, width: 50, height: 20 } },
    ] });
    const result = centerNodes(editor, { ids: ["first", "second"], axis: "horizontal" });
    expect(result.relativeTo).toBe("selection");
    expect(editor.document.nodes.first.x + editor.document.nodes.first.width / 2).toBe(125);
    expect(editor.document.nodes.second.x + editor.document.nodes.second.width / 2).toBe(125);
    expect(editor.document.nodes.first.y).toBe(10);
  });

  it("centers multiple layers as a group in their parent", () => {
    const editor = session();
    applyExternalOperations(editor, { operations: [
      { kind: "create", node: { id: "frame", type: "frame", width: 400, height: 200 } },
      { kind: "create", parentId: "frame", node: { id: "left", type: "rectangle", x: 10, width: 50, height: 40 } },
      { kind: "create", parentId: "frame", node: { id: "right", type: "rectangle", x: 110, width: 50, height: 40 } },
    ] });
    centerNodes(editor, { ids: ["left", "right"], axis: "horizontal", relativeTo: "parent" });
    expect(editor.document.nodes.left.x).toBe(125);
    expect(editor.document.nodes.right.x).toBe(225);
  });

  it("sets uniform and independent border radii explicitly", () => {
    const editor = session();
    applyExternalOperations(editor, { operations: [{ kind: "create", node: { id: "card", type: "frame", width: 320, height: 180 } }] });
    setBorderRadius(editor, { ids: ["card"], radius: 24 });
    expect(editor.document.nodes.card.radius).toBe(24);
    setBorderRadius(editor, { ids: ["card"], cornerRadii: { topLeft: 32, topRight: 8, bottomRight: 32, bottomLeft: 8 } });
    expect(editor.document.nodes.card.cornerRadii).toEqual({ topLeft: 32, topRight: 8, bottomRight: 32, bottomLeft: 8 });
  });

  it("places a generated asset as a persistent native image layer", () => {
    const editor = session();
    applyExternalOperations(editor, { operations: [
      { kind: "create", node: { id: "hero", type: "frame", width: 1200, height: 600 } },
      { kind: "create", parentId: "hero", node: { id: "headline", type: "text", text: "A better story" } },
    ] });
    const result = placeImageNode(editor, { id: "asset_generated", mime: "image/png", dataUrl: "data:image/png;base64,test", width: 1536, height: 1024 }, {
      nodeId: "hero_art", parentId: "hero", name: "Hero background", placement: "fill-parent", fit: "cover", index: 0,
    });
    const image = editor.document.nodes.hero_art;
    expect(result.nodeId).toBe("hero_art");
    expect(image.type).toBe("image");
    expect(image.parentId).toBe("hero");
    expect(image.width).toBe(1200);
    expect(image.height).toBe(600);
    expect(editor.document.nodes.hero.type === "frame" && editor.document.nodes.hero.childIds).toEqual(["hero_art", "headline"]);
  });

  it("preserves generated image aspect ratio when one dimension is supplied", () => {
    const editor = session();
    placeImageNode(editor, { id: "asset_logo", mime: "image/png", dataUrl: "data:image/png;base64,test", width: 900, height: 600 }, {
      nodeId: "logo", name: "Brand logo", width: 300, x: 40, y: 24,
    });
    expect(editor.document.nodes.logo.width).toBe(300);
    expect(editor.document.nodes.logo.height).toBe(200);
  });

  it("rejects the removed web node type", () => {
    const editor = session();
    expect(() => applyExternalOperations(editor, {
      operations: [{ kind: "create", node: { id: "legacy", type: "web", html: "<h1>Hello</h1>", css: "" } }],
    })).toThrow("Unsupported node type: web");
  });

  it("removes legacy web nodes when opening a saved document", () => {
    const { file, page } = metadata();
    const document = {
      ...emptyDocument(),
      rootIds: ["legacy"],
      nodes: { legacy: { id: "legacy", type: "web", name: "Legacy web component", parentId: null, x: 0, y: 0, width: 300, height: 200, rotation: 0, opacity: 1, visible: true, locked: false, fill: null, stroke: null, radius: 0, shadow: null, html: "<p>Old</p>", css: "" } },
    } as unknown as OpenedFile["document"];
    const editor = new EditorSession({ file, pages: [page], page, document });
    expect(editor.document.rootIds).toEqual([]);
    expect(editor.document.nodes.legacy).toBeUndefined();
    expect(editor.saveStatus).toBe("dirty");
  });
});
