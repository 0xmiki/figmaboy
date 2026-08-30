import { describe, expect, it } from "vitest";
import { emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { DesignService } from "$lib/editor/design-service";
import { EditorSession } from "$lib/editor/editor.svelte";

function session(): EditorSession {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  return new EditorSession({ file, pages: [page], page, document: emptyDocument() } satisfies OpenedFile);
}

const source = { kind: "extension" as const, id: "local.cards", version: "1.0.0" };

describe("DesignService", () => {
  it("applies an extension transaction as one undo step", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.transact({ label: "Add card", source, operations: [
      { kind: "create", node: { id: "card", type: "rectangle", width: 240, height: 120 } },
      { kind: "update", id: "card", patch: { radius: 20 } },
    ] });
    expect(editor.document.nodes.card.radius).toBe(20);
    editor.undo();
    expect(editor.document.nodes.card).toBeUndefined();
  });

  it("keeps a canvas preview out of persistence until it is applied", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.preview({ label: "Preview card", source, operations: [{ kind: "create", node: { id: "card", type: "rectangle" } }] });
    expect(editor.document.nodes.card).toBeTruthy();
    expect(editor.persistencePaused).toBe(true);
    expect(editor.changeToken).toBe(0);
    service.discardPreview();
    expect(editor.document.nodes.card).toBeUndefined();
    expect(editor.persistencePaused).toBe(false);
  });

  it("commits a canvas preview as one undoable transaction", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.preview({ label: "Preview card", source, operations: [{ kind: "create", node: { id: "card", type: "rectangle" } }] });
    service.commitPreview();
    expect(editor.changeToken).toBe(1);
    editor.undo();
    expect(editor.document.nodes.card).toBeUndefined();
  });

  it("does not let extensions change locked layers", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.transact({ label: "Add card", source: { kind: "core", id: "test" }, operations: [{ kind: "create", node: { id: "card", type: "rectangle", locked: true } }] });
    expect(() => service.transact({ label: "Move card", source, operations: [{ kind: "update", id: "card", patch: { x: 80 } }] })).toThrow("locked");
    expect(editor.document.nodes.card.x).toBe(0);
  });
});
