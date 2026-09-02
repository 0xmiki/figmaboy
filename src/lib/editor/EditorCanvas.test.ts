import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultNode, emptyDocument, type OpenedFile } from "$lib/domain";
import EditorCanvas from "$lib/editor/EditorCanvas.svelte";
import { EditorSession } from "$lib/editor/editor.svelte";

function sessionWithRectangle() {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  const document = emptyDocument();
  const node = defaultNode("rectangle", 100, 120, { width: 80, height: 60 });
  document.nodes[node.id] = node;
  document.rootIds.push(node.id);
  return { session: new EditorSession({ file, pages: [page], page, document } satisfies OpenedFile), nodeId: node.id };
}

function sessionWithNestedText() {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  const document = emptyDocument();
  const frame = defaultNode("frame", 0, 0, { id: "frame", width: 500, height: 400 });
  const text = defaultNode("text", 40, 50, { id: "text", parentId: frame.id, width: 180, height: 36, text: "Editable label" });
  if (frame.type !== "frame") throw new Error("Expected a frame fixture");
  frame.childIds = [text.id];
  document.nodes = { [frame.id]: frame, [text.id]: text };
  document.rootIds = [frame.id];
  return { session: new EditorSession({ file, pages: [page], page, document } satisfies OpenedFile), frameId: frame.id, textId: text.id };
}

async function canvasClick(target: Element, pointerId: number, detail: number) {
  await fireEvent.pointerDown(target, { button: 0, pointerId, detail, clientX: 60, clientY: 70 });
  await fireEvent.pointerUp(window, { button: 0, pointerId, detail, clientX: 60, clientY: 70 });
}

describe("canvas interaction preview", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the document unchanged during a drag and commits once on release", async () => {
    const { session, nodeId } = sessionWithRectangle();
    const initialChangeToken = session.changeToken;
    const view = render(EditorCanvas, { session, onContextMenu: () => {} });
    const node = view.container.querySelector<SVGGElement>(`[data-node-id='${nodeId}']`);
    expect(node).toBeTruthy();

    await fireEvent.pointerDown(node!, { button: 0, pointerId: 1, clientX: 110, clientY: 130 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 170, clientY: 170 });
    await waitFor(() => expect(node).toHaveAttribute("transform", expect.stringContaining("translate(160 160)")));
    expect(session.document.nodes[nodeId]).toMatchObject({ x: 100, y: 120 });
    expect(session.hasActiveGesture).toBe(true);

    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 170, clientY: 170 });
    expect(session.document.nodes[nodeId]).toMatchObject({ x: 160, y: 160 });
    expect(session.changeToken).toBe(initialChangeToken + 1);
    expect(session.hasActiveGesture).toBe(false);
  });

  it("opens a selected parent frame context menu when the pointer is over a child", async () => {
    const { session, frameId, textId } = sessionWithNestedText();
    const onContextMenu = vi.fn();
    const view = render(EditorCanvas, { session, onContextMenu });
    const text = view.container.querySelector<SVGGElement>(`[data-node-id='${textId}']`);
    expect(text).toBeTruthy();
    session.select(frameId);

    await fireEvent.contextMenu(text!, { clientX: 60, clientY: 70 });

    expect(session.selectedIds).toEqual([frameId]);
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), expect.anything(), frameId);
  });

  it("selects nested text on the first double-click and edits it on the second", async () => {
    const { session, textId } = sessionWithNestedText();
    const view = render(EditorCanvas, { session, onContextMenu: () => {} });
    const text = view.container.querySelector<SVGGElement>(`[data-node-id='${textId}']`);
    expect(text).toBeTruthy();

    await canvasClick(text!, 1, 1);
    await canvasClick(text!, 2, 2);
    await fireEvent.dblClick(text!);
    expect(session.selectedIds).toEqual([textId]);
    expect(session.editingTextId).toBeNull();

    await canvasClick(text!, 3, 1);
    await canvasClick(text!, 4, 2);
    await fireEvent.dblClick(text!);
    expect(session.editingTextId).toBe(textId);
    expect(view.getByRole("textbox", { name: "Edit text" })).toBeInTheDocument();
  });
});
