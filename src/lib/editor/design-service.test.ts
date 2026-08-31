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

  it("coalesces accepted evolve checkpoints into one undo entry", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.transact({ label: "Baseline", source: { kind: "core", id: "test" }, operations: [{ kind: "create", node: { id: "card", type: "rectangle", x: 10 } }] });
    service.preview({ label: "Evolve frame", source: { kind: "codex", id: "evolve:run-1" }, expectedChangeToken: 1, operations: [{ kind: "update", id: "card", patch: { x: 40 } }] });
    service.commitPreview();
    service.preview({ label: "Evolve frame", source: { kind: "codex", id: "evolve:run-1" }, expectedChangeToken: 2, operations: [{ kind: "update", id: "card", patch: { x: 90, y: 55 } }] });
    service.commitPreview();
    expect(editor.document.nodes.card.x).toBe(90);
    expect(editor.document.nodes.card.y).toBe(55);
    editor.undo();
    expect(editor.document.nodes.card.x).toBe(10);
    expect(editor.document.nodes.card.y).toBe(0);
  });

  it("discards a temporary candidate when the user changes pages", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.preview({ label: "Evolve frame", source: { kind: "codex", id: "evolve" }, operations: [{ kind: "create", node: { id: "candidate", type: "rectangle" } }] });
    editor.setPage({ ...editor.page, id: "page-2", name: "Page 2" }, emptyDocument());
    expect(editor.hasExternalPreview).toBe(false);
    expect(editor.externalPreviewActive).toBe(false);
    expect(editor.persistencePaused).toBe(false);
    expect(editor.document.nodes.candidate).toBeUndefined();
  });

  it("does not let extensions change locked layers", () => {
    const editor = session();
    const service = new DesignService(editor);
    service.transact({ label: "Add card", source: { kind: "core", id: "test" }, operations: [{ kind: "create", node: { id: "card", type: "rectangle", locked: true } }] });
    expect(() => service.transact({ label: "Move card", source, operations: [{ kind: "update", id: "card", patch: { x: 80 } }] })).toThrow("locked");
    expect(editor.document.nodes.card.x).toBe(0);
  });
});
