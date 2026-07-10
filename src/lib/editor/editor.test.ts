import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { EditorSession } from "$lib/editor/editor.svelte";

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
});
