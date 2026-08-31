import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNode, emptyDocument, type OpenedFile } from "$lib/domain";
import { EditorSession } from "$lib/editor/editor.svelte";
import FrameFullscreenPreview from "$lib/editor/FrameFullscreenPreview.svelte";

function session(): { editor: EditorSession; frameId: string } {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  const editor = new EditorSession({ file, pages: [page], page, document: emptyDocument() } satisfies OpenedFile);
  const frame = defaultNode("frame", 100, 80, { name: "Terminal chat", width: 960, height: 640 });
  editor.addNode(frame);
  editor.addNode(defaultNode("rectangle", 24, 24, { width: 180, height: 72 }), frame.id);
  return { editor, frameId: frame.id };
}

describe("frame fullscreen preview", () => {
  afterEach(cleanup);

  it("opens the selected frame with zoom, fit, and close controls", async () => {
    const { editor, frameId } = session();
    const onClose = vi.fn();
    render(FrameFullscreenPreview, { session: editor, frameId, onClose });

    expect(screen.getByRole("dialog", { name: "Fullscreen preview of Terminal chat" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Fit frame" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
