import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDocument } from "$lib/domain";
import type { OpenedFile } from "$lib/domain";
import { EditorSession } from "$lib/editor/editor.svelte";
import ExtensionsSidebar from "$lib/extensions/ExtensionsSidebar.svelte";
import { repository } from "$lib/repository";
import { stageExtensionManifest } from "$lib/extensions/staging";

function editor(): EditorSession {
  const timestamp = new Date(0).toISOString();
  const file = { id: "file", projectId: null, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, trashedAt: null, thumbnail: null };
  const page = { id: "page", fileId: file.id, name: "Page 1", position: 0, revision: 0 };
  return new EditorSession({ file, pages: [page], page, document: emptyDocument() } satisfies OpenedFile);
}

const manifest = {
  format: "figmaboy-extension",
  apiVersion: 1,
  id: "codex.create-card",
  name: "Create card",
  version: "1.0.0",
  permissions: ["ui.sidebar", "design.write"],
  contributes: { sidebar: [{
    id: "cards", title: "Card builder", controls: [{ type: "button", id: "create", label: "Create card", action: {
      type: "design.transact", label: "Create card", operations: [{ kind: "create", node: { type: "frame", width: 320, height: 180 } }],
    } }],
  }] },
};

describe("Extensions sidebar staging", () => {
  beforeEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });
  afterEach(cleanup);

  it("shows a Codex-staged manifest as a trial without a manual import", async () => {
    render(ExtensionsSidebar, { session: editor(), onClose: () => {} });
    await screen.findByText("Create extensions with Codex");
    await stageExtensionManifest(repository(), manifest);
    await screen.findByText("Version 1.0.0 is running as a trial.");
    expect(screen.getByText("Card builder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    await waitFor(async () => expect((await repository().extensionsList())[0].activeHash).toBeNull());
  });
});
