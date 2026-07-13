import { beforeEach, describe, expect, it } from "vitest";
import { repository } from "$lib/repository";

describe("browser persistence adapter", () => {
  beforeEach(() => localStorage.clear());

  it("creates an empty design in Drafts and persists it", async () => {
    const repo = repository();
    const opened = await repo.createFile(null);
    expect(opened.file.projectId).toBeNull();
    expect(opened.pages).toHaveLength(1);
    expect(opened.document.rootIds).toEqual([]);
    expect(Object.keys(opened.document.nodes)).toHaveLength(0);
    const library = await repo.library();
    expect(library.files.some((file) => file.id === opened.file.id)).toBe(true);
  });

  it("moves deleted files through Trash and restoration", async () => {
    const repo = repository();
    const opened = await repo.createFile(null);
    await repo.trashFile(opened.file.id);
    expect((await repo.library()).files.find((file) => file.id === opened.file.id)?.trashedAt).not.toBeNull();
    await repo.restoreItem("file", opened.file.id);
    expect((await repo.library()).files.find((file) => file.id === opened.file.id)?.trashedAt).toBeNull();
  });

  it("guards page revisions", async () => {
    const repo = repository();
    const opened = await repo.createFile(null);
    const nextRevision = await repo.savePage(opened.page.id, 0, opened.document);
    expect(nextRevision).toBe(1);
    await expect(repo.savePage(opened.page.id, 0, opened.document)).rejects.toThrow("REVISION_CONFLICT");
  });

  it("recovers the workspace from the last valid backup", async () => {
    const repo = repository();
    const opened = await repo.createFile(null);
    const saved = localStorage.getItem("figmaboy.workspace.v1");
    expect(saved).toBeTruthy();
    localStorage.setItem("figmaboy.workspace.v1.backup", saved!);
    localStorage.setItem("figmaboy.workspace.v1", "{broken json");
    expect((await repo.library()).files.some((file) => file.id === opened.file.id)).toBe(true);
    expect(() => JSON.parse(localStorage.getItem("figmaboy.workspace.v1")!)).not.toThrow();
  });

  it("repairs an invalid saved document instead of failing to open the file", async () => {
    const timestamp = new Date(0).toISOString();
    localStorage.setItem("figmaboy.workspace.v1", JSON.stringify({
      projects: [],
      files: [{ id: "file-bad", projectId: null, name: "Recovered", starred: false, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: null, trashedAt: null, thumbnail: null }],
      pages: [{ id: "page-bad", fileId: "file-bad", name: "Page 1", position: 0, revision: 0 }],
      documents: { "page-bad": { schemaVersion: 1, rootIds: ["bad", "card"], nodes: { bad: { type: "movie" }, card: { id: "card", type: "rectangle", x: 10, y: 20, width: -30, height: 40 } }, viewport: { zoom: 0 } } },
      assets: {},
    }));
    const opened = await repository().openFile("file-bad");
    expect(opened.document.rootIds).toEqual(["card"]);
    expect(opened.document.nodes.card).toMatchObject({ x: -20, width: 30 });
    expect(opened.document.viewport.zoom).toBe(.05);
  });
});
