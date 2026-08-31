import { describe, expect, it } from "vitest";
import { COMPOSER_COMMANDS, composerTrigger, emptyCodexUiState, parseCodexUiState, replaceComposerTrigger } from "$lib/codex-ui-state";

describe("Codex UI state", () => {
  it("repairs partial persisted state", () => {
    expect(parseCodexUiState({ favoriteModels: ["legacy"], approvalMode: "auto" })).toEqual({
      ...emptyCodexUiState(),
      approvalMode: "auto",
    });
  });

  it("detects and replaces composer commands, mentions, and skills", () => {
    expect(composerTrigger("Please use @sel")).toEqual({ kind: "mention", query: "sel", start: 11 });
    expect(composerTrigger("$image")).toEqual({ kind: "skill", query: "image", start: 0 });
    expect(replaceComposerTrigger("Please use @sel", 11, "@selection")).toBe("Please use @selection ");
    expect(COMPOSER_COMMANDS).toContainEqual(expect.objectContaining({ label: "/install-mcp", action: "install-mcp" }));
  });

  it("keeps the last selected thread separate for each design page", () => {
    expect(parseCodexUiState({ lastThreadId: "legacy", lastThreadIdByPage: { page_a: "thread_a", page_b: null, invalid: 42 } })).toEqual(expect.objectContaining({
      lastThreadId: "legacy",
      lastThreadIdByPage: { page_a: "thread_a", page_b: null },
    }));
  });

  it("repairs persisted skill attachments", () => {
    expect(parseCodexUiState({ drafts: { __new__: { prompt: "Polish this", attachments: [], skills: [{ name: "first-principles-ui", path: "/skills/ui" }, { name: 42 }] } } }).drafts.__new__).toEqual({
      prompt: "Polish this",
      attachments: [],
      skills: [{ name: "first-principles-ui", path: "/skills/ui" }],
    });
  });
});
