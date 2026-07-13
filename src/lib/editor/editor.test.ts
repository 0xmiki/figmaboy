import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { EditorSession } from "$lib/editor/editor.svelte";
import { worldBounds } from "$lib/geometry";

function opened(): OpenedFile {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  return { file, pages: [page], page, document: emptyDocument() };
}

describe("editor commands", () => {
  it("starts a production file with no design nodes", () => {
    const session = new EditorSession(opened());
    expect(session.document.rootIds).toEqual([]);
    expect(session.document.nodes).toEqual({});
  });

  it("adds, deletes, undoes, and redoes nodes", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 20);
    session.addNode(node);
    expect(session.document.rootIds).toEqual([node.id]);
    session.deleteSelection();
    expect(session.document.rootIds).toEqual([]);
    session.undo();
    expect(session.document.nodes[node.id]).toBeTruthy();
    session.redo();
    expect(session.document.nodes[node.id]).toBeUndefined();
  });

  it("groups and ungroups while preserving visual positions", () => {
    const session = new EditorSession(opened());
    const first = defaultNode("rectangle", 10, 20, { width: 20, height: 30 });
    const second = defaultNode("ellipse", 50, 60, { width: 40, height: 20 });
    session.addNode(first);
    session.addNode(second);
    session.selectedIds = [first.id, second.id];
    session.groupSelection();
    const group = session.selectedNodes[0];
    expect(group.type).toBe("group");
    expect(group.x).toBe(10);
    expect(session.document.nodes[first.id].x).toBe(0);
    session.ungroupSelection();
    expect(session.document.nodes[first.id].x).toBe(10);
    expect(session.document.nodes[second.id].y).toBe(60);
  });

  it("preserves rotated child geometry through grouping and ungrouping", () => {
    const session = new EditorSession(opened());
    const first = defaultNode("rectangle", 20, 30, { width: 80, height: 40, rotation: 25 });
    const second = defaultNode("ellipse", 140, 70, { width: 50, height: 90, rotation: -15 });
    session.document.nodes = { [first.id]: first, [second.id]: second };
    session.document.rootIds = [first.id, second.id];
    session.selectedIds = [first.id, second.id];
    const before = [worldBounds(session.document, first), worldBounds(session.document, second)];
    session.groupSelection();
    session.ungroupSelection();
    [first.id, second.id].forEach((id, index) => {
      const after = worldBounds(session.document, session.document.nodes[id]);
      expect(after.x).toBeCloseTo(before[index].x);
      expect(after.y).toBeCloseTo(before[index].y);
      expect(after.width).toBeCloseTo(before[index].width);
      expect(after.height).toBeCloseTo(before[index].height);
    });
  });

  it("coalesces pointer gestures into a single undo step", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 10);
    session.addNode(node);
    session.beginGesture();
    session.document.nodes[node.id].x = 90;
    session.gestureChanged();
    session.document.nodes[node.id].x = 140;
    session.commitGesture();
    session.undo();
    expect(session.document.nodes[node.id].x).toBe(10);
  });

  it("does not expose transform previews to autosave before commit", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 10);
    session.addNode(node);
    const token = session.changeToken;
    session.beginGesture();
    session.document.nodes[node.id].x = 90;
    session.previewGesture();
    expect(session.changeToken).toBe(token);
    session.commitGesture();
    expect(session.changeToken).toBe(token + 1);
  });

  it("restores the gesture snapshot when cancellation is requested", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 10);
    session.addNode(node);
    session.beginGesture();
    session.document.nodes[node.id].x = 200;
    session.previewGesture();
    session.cancelGesture();
    expect(session.document.nodes[node.id].x).toBe(10);
    expect(session.hasActiveGesture).toBe(false);
  });

  it("cancels an interrupted gesture before an external deletion", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 10);
    session.addNode(node);
    session.beginGesture();
    session.document.nodes[node.id].x = 200;
    session.previewGesture();
    session.deleteSelection();
    expect(session.document.nodes[node.id]).toBeUndefined();
    session.undo();
    expect(session.document.nodes[node.id].x).toBe(10);
  });

  it("keeps the current viewport when undoing document edits", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 10);
    session.addNode(node);
    session.updateSelected({ x: 80 });
    session.document.viewport = { x: 333, y: -120, zoom: 2.5 };
    session.undo();
    expect(session.document.nodes[node.id].x).toBe(10);
    expect(session.document.viewport).toEqual({ x: 333, y: -120, zoom: 2.5 });
  });

  it("stores an undoable corner radius on box-like nodes", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 0, 0, { width: 160, height: 100 });
    session.addNode(node);
    session.updateSelected({ radius: 24 });
    expect(session.document.nodes[node.id].radius).toBe(24);
    session.undo();
    expect(session.document.nodes[node.id].radius).toBe(0);
  });

  it("duplicates a nested layer beside the source inside the same frame", () => {
    const session = new EditorSession(opened());
    const frame = defaultNode("frame", 100, 100, { width: 300, height: 200 });
    const card = defaultNode("rectangle", 20, 30, { width: 80, height: 60, parentId: frame.id });
    if (frame.type !== "frame") throw new Error("expected a frame");
    frame.childIds.push(card.id);
    session.document.nodes = { [frame.id]: frame, [card.id]: card };
    session.document.rootIds = [frame.id];
    session.selectedIds = [card.id];

    session.duplicateSelection({ x: 12, y: 8 });
    const copy = session.selectedNodes[0];
    expect(copy.parentId).toBe(frame.id);
    expect(copy.x).toBe(32);
    expect(copy.y).toBe(38);
    expect((session.document.nodes[frame.id] as typeof frame).childIds).toEqual([card.id, copy.id]);
  });

  it("copies and repeatedly pastes editable objects with a cascading offset", async () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 20);
    session.addNode(node);
    session.copy();
    await session.paste();
    expect(session.selectedNodes[0]).toMatchObject({ x: 34, y: 44, type: "rectangle" });
    await session.paste();
    expect(session.selectedNodes[0]).toMatchObject({ x: 58, y: 68, type: "rectangle" });
    expect(session.document.rootIds).toHaveLength(3);
  });

  it("ignores malformed clipboard payloads without changing the document", async () => {
    const session = new EditorSession(opened());
    session.clipboard = { nodes: [{ id: "bad", type: "unknown" }], rootIds: ["bad"] } as never;
    await expect(session.paste()).resolves.toBeUndefined();
    expect(session.document.rootIds).toEqual([]);
  });

  it("canonicalizes parent and child multi-selections", () => {
    const session = new EditorSession(opened());
    const frame = defaultNode("frame", 0, 0);
    const child = defaultNode("rectangle", 10, 10, { parentId: frame.id });
    if (frame.type !== "frame") throw new Error("expected a frame");
    frame.childIds = [child.id];
    session.document.nodes = { [frame.id]: frame, [child.id]: child };
    session.document.rootIds = [frame.id];
    session.setSelection([frame.id, child.id]);
    expect(session.selectedIds).toEqual([frame.id]);
  });

  it("aligns rotated objects in world space as one command", () => {
    const session = new EditorSession(opened());
    const first = defaultNode("rectangle", 20, 30, { width: 80, height: 40, rotation: 25 });
    const second = defaultNode("ellipse", 170, 90, { width: 50, height: 90, rotation: -15 });
    session.document.nodes = { [first.id]: first, [second.id]: second };
    session.document.rootIds = [first.id, second.id];
    session.selectedIds = [first.id, second.id];
    session.alignSelection("left");
    expect(worldBounds(session.document, session.document.nodes[first.id]).x).toBeCloseTo(worldBounds(session.document, session.document.nodes[second.id]).x);
    session.undo();
    expect(worldBounds(session.document, session.document.nodes[second.id]).x).not.toBeCloseTo(worldBounds(session.document, session.document.nodes[first.id]).x);
  });

  it("coalesces an Alt-drag duplicate and movement into one undo entry", () => {
    const session = new EditorSession(opened());
    const node = defaultNode("rectangle", 10, 20);
    session.addNode(node);
    session.beginGesture();
    session.duplicateSelection({ x: 0, y: 0 }, false);
    session.selectedNodes[0].x += 50;
    session.gestureChanged();
    session.commitGesture();

    expect(session.document.rootIds).toHaveLength(2);
    session.undo();
    expect(session.document.rootIds).toEqual([node.id]);
    expect(session.document.nodes[node.id].x).toBe(10);
  });

  it("reparents a layer out of a frame without changing its world position", () => {
    const session = new EditorSession(opened());
    const frame = defaultNode("frame", 100, 200, { width: 400, height: 300 });
    const card = defaultNode("rectangle", 30, 40, { width: 120, height: 80, parentId: frame.id });
    if (frame.type !== "frame") throw new Error("expected a frame");
    frame.childIds.push(card.id);
    session.document.nodes = { [frame.id]: frame, [card.id]: card };
    session.document.rootIds = [frame.id];
    session.selectedIds = [card.id];
    const before = session.bounds;

    session.reparentSelection(null);

    expect(session.document.nodes[card.id].parentId).toBeNull();
    expect((session.document.nodes[frame.id] as typeof frame).childIds).toEqual([]);
    expect(session.document.rootIds).toEqual([frame.id, card.id]);
    expect(session.bounds).toEqual(before);
    expect(session.document.nodes[card.id]).toMatchObject({ x: 130, y: 240 });
  });

  it("moves a layer through the hierarchy without changing world geometry or creating cycles", () => {
    const session = new EditorSession(opened());
    const frame = defaultNode("frame", 100, 200, { width: 300, height: 200, rotation: 15 });
    const card = defaultNode("rectangle", 350, 260, { width: 60, height: 40 });
    if (frame.type !== "frame") throw new Error("expected a frame");
    session.document.nodes = { [frame.id]: frame, [card.id]: card };
    session.document.rootIds = [frame.id, card.id];
    const before = worldBounds(session.document, card);
    session.moveNode(card.id, frame.id, 0);
    const after = worldBounds(session.document, session.document.nodes[card.id]);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
    session.moveNode(frame.id, card.id, 0);
    expect(session.document.nodes[frame.id].parentId).toBeNull();
  });
});
