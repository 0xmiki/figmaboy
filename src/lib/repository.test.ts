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
});
