import { describe, expect, it } from "vitest";
import { COMPOSER_COMMANDS, composerTrigger, emptyCodexUiState, evolveDirection, parseCodexUiState, replaceComposerTrigger } from "$lib/codex-ui-state";

describe("Codex UI state", () => {
  it("repairs partial persisted state", () => {
    expect(parseCodexUiState({ favoriteModels: ["legacy"], approvalMode: "auto" })).toEqual({
      ...emptyCodexUiState(),
      approvalMode: "auto",
    });
  });

  it("detects and replaces composer commands, mentions, and skills", () => {
    expect(composerTrigger("Please use @sel")).toEqual({ kind: "mention", query: "sel", start: 11, end: 15 });
    expect(composerTrigger("$image")).toEqual({ kind: "skill", query: "image", start: 0, end: 6 });
    expect(composerTrigger("before $fir after", 11)).toEqual({ kind: "skill", query: "fir", start: 7, end: 11 });
    expect(replaceComposerTrigger("Please use @sel", 11, "@selection")).toBe("Please use @selection ");
    expect(replaceComposerTrigger("before $fir after", 7, "$first-principles-ui", 11)).toBe("before $first-principles-ui after");
    expect(COMPOSER_COMMANDS.some((command) => command.label === "/install-mcp")).toBe(false);
    expect(COMPOSER_COMMANDS).toContainEqual(expect.objectContaining({ label: "/evolve", action: "evolve" }));
    expect(evolveDirection("/evolve Make it more editorial")).toBe("Make it more editorial");
    expect(evolveDirection("/evolve")).toBe("");
    expect(evolveDirection("Please evolve this")).toBeNull();
  });

  it("keeps the last selected thread separate for each design page", () => {
    expect(parseCodexUiState({ lastThreadId: "legacy", lastThreadIdByPage: { page_a: "thread_a", page_b: null, invalid: 42 } })).toEqual(expect.objectContaining({
      lastThreadId: "legacy",
      lastThreadIdByPage: { page_a: "thread_a", page_b: null },
    }));
  });

  it("repairs Figmaboy-owned thread history without reviving an active turn", () => {
    const parsed = parseCodexUiState({
      localThreads: {
        local: {
          thread: { id: "local", preview: "Build a card", name: "Card", createdAt: 1, updatedAt: 2, cwd: "/tmp/design" },
          timeline: {
            items: [{ id: "user", type: "userMessage", content: [{ type: "text", text: "Build a card" }] }],
            activeTurnId: "turn",
            error: "",
            turns: { turn: { id: "turn", status: "inProgress", startedAt: 1, completedAt: null, durationMs: null, error: "" } },
          },
        },
        invalid: { thread: { preview: "Missing id" }, timeline: {} },
      },
    });
    expect(parsed.localThreads.local.thread).toEqual(expect.objectContaining({ id: "local", name: "Card", status: { type: "notLoaded" } }));
    expect(parsed.localThreads.local.timeline.activeTurnId).toBeNull();
    expect(parsed.localThreads.local.timeline.turns.turn.status).toBe("interrupted");
    expect(parsed.localThreads.invalid).toBeUndefined();
  });

  it("repairs persisted skill attachments", () => {
    expect(parseCodexUiState({ drafts: { __new__: { prompt: "Polish this", attachments: [], skills: [{ name: "first-principles-ui", path: "/skills/ui" }, { name: 42 }] } } }).drafts.__new__).toEqual({
      prompt: "Polish this",
      attachments: [],
      skills: [{ name: "first-principles-ui", path: "/skills/ui" }],
    });
  });
});
