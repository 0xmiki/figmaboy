import { describe, expect, it } from "vitest";
import { emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { DesignService } from "$lib/editor/design-service";
import { EditorSession } from "$lib/editor/editor.svelte";
import { materializeExtensionOperations, runExtensionAction } from "$lib/extensions/runtime";

function editor(): EditorSession {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  return new EditorSession({ file, pages: [page], page, document: emptyDocument() } satisfies OpenedFile);
}

describe("extension canvas actions", () => {
  it("expands selection targets and typed control references", () => {
    const operations = materializeExtensionOperations([
      { kind: "update", target: "selection", patch: { radius: { $control: "radius" }, name: { $control: "name" } } },
    ], { radius: 24, name: "Card" }, ["one", "two"]);
    expect(operations).toEqual([
      { kind: "update", id: "one", patch: { radius: 24, name: "Card" } },
      { kind: "update", id: "two", patch: { radius: 24, name: "Card" } },
    ]);
  });

  it("does not run selection actions without a selection", () => {
    expect(() => materializeExtensionOperations([
      { kind: "delete", target: "selection" },
    ], {}, [])).toThrow("layer IDs");
  });

  it("commits legacy preview-mode actions immediately as one undo step", () => {
    const session = editor();
    runExtensionAction(new DesignService(session), {
      format: "figmaboy-extension", apiVersion: 1, id: "test.cards", name: "Cards", version: "1.0.0",
      permissions: ["ui.sidebar", "design.write"], contributes: { sidebar: [] },
    }, {
      type: "design.transact", label: "Create card", mode: "preview",
      operations: [{ kind: "create", node: { id: "card", type: "rectangle" } }],
    }, {});
    expect(session.document.nodes.card).toBeTruthy();
    expect(session.externalPreviewActive).toBe(false);
    expect(session.changeToken).toBe(1);
    session.undo();
    expect(session.document.nodes.card).toBeUndefined();
  });
});
