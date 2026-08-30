import { describe, expect, it } from "vitest";
import { buildDisplayTimelineRows, contextPercentage, emptyTimeline, groupToolItems, reduceCodexEvent, resolveCodexSelection, serviceTierOptions, timelineFromThread, uniqueEnabledSkills, type CodexModel, type CodexTimeline } from "$lib/codex-protocol";

const empty = (): CodexTimeline => emptyTimeline();

describe("Codex app-server timeline", () => {
  it("streams an agent message and replaces it with the completed item", () => {
    let state = reduceCodexEvent(empty(), {
      method: "item/agentMessage/delta",
      params: { threadId: "thread", itemId: "message", delta: "Hello" },
    }, "thread");
    state = reduceCodexEvent(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread", itemId: "message", delta: " world" },
    }, "thread");
    expect(state.items[0].text).toBe("Hello world");

    state = reduceCodexEvent(state, {
      method: "item/completed",
      params: { threadId: "thread", item: { id: "message", type: "agentMessage", text: "Hello world", phase: null } },
    }, "thread");
    expect(state.items).toHaveLength(1);
  });

  it("reconciles optimistic user messages", () => {
    const state = reduceCodexEvent({ ...empty(), items: [{ id: "local_1", type: "userMessage", content: [{ type: "text", text: "Make a card" }] }] }, {
      method: "item/started",
      params: { threadId: "thread", item: { id: "server_1", type: "userMessage", content: [{ type: "text", text: "Make a card" }] } },
    }, "thread");
    expect(state.items).toEqual([{ id: "server_1", type: "userMessage", content: [{ type: "text", text: "Make a card" }] }]);
  });

  it("loads persisted turns and ignores other threads", () => {
    const state = timelineFromThread({
      id: "thread",
      preview: "Test",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      cwd: "/tmp",
      turns: [{ id: "turn", status: "completed", items: [{ id: "one", type: "agentMessage", text: "Done" }] }],
    });
    const unchanged = reduceCodexEvent(state, {
      method: "item/agentMessage/delta",
      params: { threadId: "another", itemId: "one", delta: "!" },
    }, "thread");
    expect(unchanged).toBe(state);
  });

  it("uses the latest request for context while retaining cumulative thread usage", () => {
    const state = reduceCodexEvent(empty(), {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread",
        tokenUsage: {
          total: { totalTokens: 1_015_449, inputTokens: 1_006_691, cachedInputTokens: 931_072, outputTokens: 8_758, reasoningOutputTokens: 3_014 },
          last: { totalTokens: 78_171, inputTokens: 77_963, cachedInputTokens: 75_136, outputTokens: 208, reasoningOutputTokens: 104 },
          modelContextWindow: 828_400,
        },
      },
    }, "thread");
    expect(state.usage).toMatchObject({
      totalTokens: 78_171,
      inputTokens: 77_963,
      cachedInputTokens: 75_136,
      outputTokens: 208,
      threadTotalTokens: 1_015_449,
      modelContextWindow: 828_400,
    });
    expect(contextPercentage(state.usage)).toBeCloseTo(9.436, 3);

    const legacy = reduceCodexEvent(empty(), {
      method: "thread/tokenUsage/updated",
      params: { threadId: "thread", tokenUsage: { total: { totalTokens: 50_000, inputTokens: 49_000, cachedInputTokens: 40_000, outputTokens: 1_000 }, modelContextWindow: 100_000 } },
    }, "thread");
    expect(legacy.usage).toMatchObject({ totalTokens: 50_000, threadTotalTokens: 50_000 });
    expect(contextPercentage(legacy.usage)).toBe(50);
  });

  it("heals unsupported effort and tier values when the model changes", () => {
    const models: CodexModel[] = [{
      id: "sol", model: "sol", displayName: "Sol", description: "", isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
      serviceTiers: [{ id: "fast", name: "Fast" }],
    }];
    expect(resolveCodexSelection(models, { model: "sol", effort: "ultra", serviceTier: "missing" })).toEqual({ model: "sol", effort: "low", serviceTier: "default" });
    expect(serviceTierOptions(models[0]).map((tier) => tier.id)).toEqual(["default", "fast"]);
  });

  it("compresses consecutive design tools into a useful summary", () => {
    const groups = groupToolItems([
      { id: "a", type: "mcpToolCall", server: "figmaboy", tool: "document_get", status: "completed", _turnId: "turn" },
      { id: "b", type: "mcpToolCall", server: "figmaboy", tool: "operations_apply", status: "completed", _turnId: "turn" },
      { id: "c", type: "mcpToolCall", server: "figmaboy", tool: "frame_screenshot", status: "completed", _turnId: "turn" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].summary).toBe("Inspected 1 design source · Applied 1 design change · Captured 1 preview");
  });

  it("folds every intermediate tool burst in a settled turn into one disclosure", () => {
    const timeline: CodexTimeline = {
      ...emptyTimeline(),
      turns: { turn: { id: "turn", status: "completed", startedAt: 1, completedAt: 8, durationMs: 7_000, error: "" } },
      items: [
        { id: "commentary", type: "agentMessage", text: "I will inspect it.", _turnId: "turn" },
        { id: "read", type: "mcpToolCall", tool: "document_get", status: "completed", _turnId: "turn" },
        { id: "middle", type: "agentMessage", text: "Now I will edit it.", _turnId: "turn" },
        { id: "edit", type: "mcpToolCall", tool: "operations_apply", status: "completed", _turnId: "turn" },
        { id: "final", type: "agentMessage", text: "Done.", _turnId: "turn" },
      ],
    };
    const rows = buildDisplayTimelineRows(timeline);
    expect(rows.map((row) => row.kind)).toEqual(["item", "tools", "item"]);
    expect(rows[1]).toMatchObject({ kind: "tools", label: "Worked for 7s", group: { items: [{ id: "read" }, { id: "middle" }, { id: "edit" }] } });
  });

  it("shows each enabled skill name once", () => {
    expect(uniqueEnabledSkills([
      { name: "agents-sdk", path: "/one" },
      { name: "agents-sdk", path: "/two" },
      { name: "disabled", path: "/three", enabled: false },
    ])).toEqual([{ name: "agents-sdk", path: "/one" }]);
  });
});
