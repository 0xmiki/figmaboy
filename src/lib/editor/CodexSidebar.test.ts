import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clipboardWriteMock, eventHandlers, evolveFixture, invokeMock, listenMock, skillFixture, threadFixture, threadItemsFixture, uiStateFixture } = vi.hoisted(() => ({
  clipboardWriteMock: vi.fn(),
  eventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  evolveFixture: { thread: 0, preview: 0, render: 0, changeToken: 7, previewErrors: [] as string[] },
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  skillFixture: [] as Array<{ name: string; path: string; description?: string }>,
  threadFixture: [] as Array<Record<string, unknown>>,
  threadItemsFixture: [] as Array<Record<string, unknown>>,
  uiStateFixture: { value: null as unknown },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import CodexSidebar from "$lib/editor/CodexSidebar.svelte";

describe("Codex sidebar diagnostics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clipboardWriteMock.mockReset();
    listenMock.mockClear();
    eventHandlers.clear();
    evolveFixture.thread = 0;
    evolveFixture.preview = 0;
    evolveFixture.render = 0;
    evolveFixture.changeToken = 7;
    evolveFixture.previewErrors.splice(0);
    skillFixture.splice(0);
    threadFixture.splice(0);
    threadItemsFixture.splice(0);
    uiStateFixture.value = null;
    localStorage.clear();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(event, handler);
      return () => eventHandlers.delete(event);
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Linux test" });
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "codex_ui_state_read") return uiStateFixture.value;
      if (command === "codex_connect") return { workspaceId: "file", cwd: "/tmp/figmaboy", reused: false };
      if (command === "codex_clipboard_read") return { kind: "image", data_url: "data:image/png;base64,iVBORw0KGgo=", name: "native-paste.png" };
      if (command === "codex_attachment_save") return { path: "/tmp/pasted-image.png", mime: "image/png", name: String(args?.name ?? "pasted-image.png") };
      if (command === "codex_disconnect") return null;
      if (command !== "codex_request") return null;
      if (args?.method === "account/read") return { account: { type: "chatgpt" } };
      if (args?.method === "model/list") {
        return {
          data: [{
            id: "gpt-test",
            model: "gpt-test",
            displayName: "GPT Test",
            description: "",
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            serviceTiers: [{ id: "priority", name: "Fast" }],
            additionalSpeedTiers: ["fast"],
          }],
        };
      }
      if (args?.method === "thread/list") return { data: threadFixture };
      if (args?.method === "thread/resume") {
        const params = (args.params ?? {}) as Record<string, unknown>;
        const thread = threadFixture.find((item) => item.id === params.threadId);
        return {
          thread: {
            ...thread,
            turns: thread?.emptyTurns ? [] : [{
              id: "stored-turn",
              status: "completed",
              items: [
                { id: "stored-user", type: "userMessage", content: [{ type: "text", text: "Previous user request" }] },
                { id: "stored-agent", type: "agentMessage", text: "Previous assistant reply" },
              ],
            }],
          },
          model: "gpt-test",
          reasoningEffort: "medium",
          serviceTier: null,
        };
      }
      if (args?.method === "thread/read") {
        const params = (args.params ?? {}) as Record<string, unknown>;
        const thread = threadFixture.find((item) => item.id === params.threadId);
        return { thread: { ...thread, turns: [] } };
      }
      if (args?.method === "thread/items/list") return { data: threadItemsFixture, nextCursor: null };
      if (args?.method === "skills/list") return { data: [{ cwd: "/tmp/figmaboy", skills: skillFixture }] };
      if (args?.method === "mcpServer/tool/call") {
        const params = (args.params ?? {}) as Record<string, unknown>;
        if (params.tool === "editor_status") return { content: [], structuredContent: { selectedIds: ["screen"], changeToken: evolveFixture.changeToken } };
        if (params.tool === "document_get") return { content: [], structuredContent: { changeToken: evolveFixture.changeToken, document: { rootIds: ["screen"], nodes: {
          screen: { id: "screen", type: "frame", name: "Screen", x: 0, y: 0, width: 1440, height: 810, childIds: ["headline"] },
          headline: { id: "headline", type: "text", name: "Headline", parentId: "screen", x: 80, y: 80, width: 600, height: 100, text: "Original headline", fontSize: 64 },
        } } } };
        if (params.tool === "geometry_get") return { content: [], structuredContent: { nodes: [{ id: "screen", local: { x: 0, y: 0, width: 1440, height: 810 } }] } };
        if (params.tool === "frame_screenshot") return { content: [{ type: "image", data: evolveFixture.preview ? `candidate-${evolveFixture.render}` : "baseline", mimeType: "image/png" }], structuredContent: { width: 1080, height: 608 } };
        if (params.tool === "operations_preview") {
          const previewError = evolveFixture.previewErrors.shift();
          if (previewError) throw new Error(previewError);
          evolveFixture.preview = 1; evolveFixture.render += 1;
          return { content: [], structuredContent: { ok: true, previewActive: true } };
        }
        if (params.tool === "operations_preview_commit") { evolveFixture.preview = 0; evolveFixture.changeToken += 1; return { content: [], structuredContent: { ok: true, previewActive: false, changeToken: evolveFixture.changeToken } }; }
        if (params.tool === "operations_preview_discard") { evolveFixture.preview = 0; return { content: [], structuredContent: { ok: true, previewActive: false } }; }
        return { content: [], structuredContent: { ok: true } };
      }
      if (args?.method === "thread/start") {
        const params = (args.params ?? {}) as Record<string, unknown>;
        const serviceName = typeof params.serviceName === "string" ? params.serviceName : "figmaboy";
        const role = serviceName.includes("director") ? "director" : serviceName.includes("designer") ? "designer" : "";
        const id = serviceName.includes("control") ? "evolve-control" : role ? `evolve-${role}-${++evolveFixture.thread}` : "thread";
        return {
          thread: { id, preview: "", name: null, createdAt: 1, updatedAt: 1, cwd: "/tmp/figmaboy", turns: [], ephemeral: serviceName.includes("evolve") },
          model: "gpt-test",
          reasoningEffort: null,
          serviceTier: null,
        };
      }
      if (args?.method === "turn/start") {
        const params = (args.params ?? {}) as Record<string, unknown>;
        return { turn: { id: `${String(params.threadId)}-turn`, status: "inProgress", items: [] } };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(navigator, "userAgent");
  });

  it("does not route app-server stderr diagnostics into the user error banner", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });

    await screen.findByPlaceholderText("Ask anything about this design");
    await waitFor(() => expect(screen.getByRole("button", { name: /GPT Test/ })).toBeInTheDocument());
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Design with Codex")).not.toBeInTheDocument();
    expect(screen.queryByText("Review the design")).not.toBeInTheDocument();
    expect(screen.queryByText("Polish the selection")).not.toBeInTheDocument();
    expect(screen.queryByText("Add a mobile screen")).not.toBeInTheDocument();
    expect(listenMock).not.toHaveBeenCalledWith("codex-log", expect.any(Function));
    expect(screen.queryByText(/failed to refresh available models/i)).not.toBeInTheDocument();
  });

  it("sends steering input while a turn is running", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    await screen.findByPlaceholderText("Ask anything about this design");
    await screen.findByRole("button", { name: /GPT Test/ });
    const textbox = screen.getByRole("textbox", { name: "Message Codex" });
    await fireEvent.input(textbox, { target: { value: "Build a card" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start" })));
    const threadStart = invokeMock.mock.calls.find(([, args]) => args?.method === "thread/start");
    expect(threadStart?.[1]?.params).not.toHaveProperty("threadSource");
    expect(threadStart?.[1]?.params?.developerInstructions).toContain("extension_stage");
    expect(threadStart?.[1]?.params?.developerInstructions).toContain("only the user may run, Keep, or Discard");

    eventHandlers.get("codex-event")?.({
      payload: { method: "turn/started", params: { threadId: "thread", turn: { id: "turn", status: "inProgress", items: [], error: null } } },
    });
    await screen.findByRole("button", { name: "Steer Codex" });
    expect(screen.getByRole("button", { name: "Stop Codex" })).toHaveTextContent("");
    await fireEvent.input(textbox, { target: { value: "Make it denser" } });
    await fireEvent.click(screen.getByRole("button", { name: "Steer Codex" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/steer", params: expect.objectContaining({ expectedTurnId: "turn" }) })));
  });

  it("loops through fresh directors and designers until two directors agree", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });

    await fireEvent.input(textbox, { target: { value: "/evolve Make it more editorial" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByPlaceholderText("Evolving the selected frame…")).toBeDisabled();
    expect(screen.getByText("Director and designer are working independently")).toBeInTheDocument();

    const finishTurn = (threadId: string, value: Record<string, unknown>) => {
      eventHandlers.get("codex-event")?.({ payload: { method: "item/completed", params: { threadId, turnId: `${threadId}-turn`, item: { id: `${threadId}-answer`, type: "agentMessage", text: JSON.stringify(value) } } } });
      eventHandlers.get("codex-event")?.({ payload: { method: "turn/completed", params: { threadId, turn: { id: `${threadId}-turn`, status: "completed", items: [] } } } });
    };
    const criteria = [
      { id: "goal-1", requirement: "Create a clear editorial reading order", status: "unmet", evidence: "The headline and metadata carry equal weight." },
      { id: "goal-2", requirement: "Preserve readable supporting content", status: "met", evidence: "The supporting copy remains readable." },
    ];

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    const directorThread = invokeMock.mock.calls.find(([, args]) => args?.method === "thread/start" && args?.params?.serviceName === "figmaboy-evolve-director");
    expect(directorThread?.[1]?.params).toMatchObject({ ephemeral: true, sandbox: "read-only", serviceTier: "priority", config: { mcp_servers: { figmaboy: { enabled: false } } } });
    const directorStart = invokeMock.mock.calls.find(([, args]) => args?.method === "turn/start" && args?.params?.threadId === "evolve-director-1");
    expect(directorStart?.[1]?.params?.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", detail: "original", url: expect.stringMatching(/^data:image\/png;base64,/) })]));
    expect(directorStart?.[1]?.params?.serviceTier).toBe("priority");
    expect(directorStart?.[1]?.params?.outputSchema).toMatchObject({ properties: { criteria: { minItems: 2, maxItems: 6 }, regions: { minItems: 0, maxItems: 3 } } });
    finishTurn("evolve-director-1", {
      verdict: "revise", preference: "not_applicable", confidence: .9, criteria,
      regions: [{ criterionId: "goal-1", x: 60, y: 50, width: 700, height: 180, priority: 1, note: "The headline and metadata have equal visual weight.", desiredOutcome: "Make the headline the unmistakable first reading point." }],
      successes: [{ criterionId: "goal-2", note: "Supporting content is already readable." }], regressions: [], summary: "The editorial hierarchy needs one material pass.",
    });
    expect(await screen.findByText("The headline and metadata have equal visual weight. → Make the headline the unmistakable first reading point.")).toBeInTheDocument();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-designer-2" }) })));
    const designerStart = invokeMock.mock.calls.find(([, args]) => args?.method === "turn/start" && args?.params?.threadId === "evolve-designer-2");
    expect(designerStart?.[1]?.params?.input?.[0]?.text).toContain("User direction: Make it more editorial");
    expect(designerStart?.[1]?.params?.input?.[0]?.text).toContain("equal visual weight");
    expect(designerStart?.[1]?.params?.input?.[0]?.text).toContain('LayerBlurEffect { type: "layer-blur"; radius: number');
    expect(designerStart?.[1]?.params?.input?.[0]?.text).toContain("Every numeric field must be a finite JSON number");
    expect(designerStart?.[1]?.params).toMatchObject({ effort: "medium", serviceTier: "priority" });
    finishTurn("evolve-designer-2", { updates: [{ id: "headline", patchJson: JSON.stringify({ x: 96, fontSize: 72 }) }], creates: [], reorders: [], removeCreatedIds: [], summary: "Improved the headline hierarchy." });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ threadId: "evolve-control", tool: "operations_preview", arguments: expect.objectContaining({ frameId: "screen", operations: [{ kind: "update", id: "headline", patch: { x: 96, fontSize: 72 } }] }) }),
    })));
    expect(await screen.findByText("Candidate is visible on canvas")).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-3" }) })));
    finishTurn("evolve-director-3", { verdict: "revise", preference: "image_1", confidence: .86, criteria, regions: [{ criterionId: "goal-1", x: 60, y: 50, width: 700, height: 180, priority: 1, note: "The first candidate still lacks decisive editorial contrast.", desiredOutcome: "Make the headline lead without overpowering supporting copy." }], successes: [{ criterionId: "goal-2", note: "Supporting content remains readable." }], regressions: [{ severity: "major", note: "The first candidate creates too much headline emphasis." }], summary: "The previous accepted version remains stronger." });
    expect(await screen.findByText("Discarded pass 1")).toBeInTheDocument();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-4" }) })));
    finishTurn("evolve-director-4", { verdict: "revise", preference: "not_applicable", confidence: .9, criteria, regions: [{ criterionId: "goal-1", x: 60, y: 50, width: 700, height: 180, priority: 1, note: "The accepted frame still needs a clearer editorial entry point.", desiredOutcome: "Strengthen the headline while preserving the supporting rhythm." }], successes: [{ criterionId: "goal-2", note: "Supporting content remains readable." }], regressions: [], summary: "Try another editorial hierarchy treatment." });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-designer-5" }) })));
    finishTurn("evolve-designer-5", { updates: [{ id: "headline", patchJson: JSON.stringify({ x: 88, fontSize: 68, fontWeight: 700 }) }], creates: [], reorders: [], removeCreatedIds: [], summary: "Built a more balanced editorial hierarchy." });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-6" }) })));
    finishTurn("evolve-director-6", { verdict: "satisfied", preference: "image_1", confidence: .9, criteria: criteria.map((criterion) => ({ ...criterion, status: "met", evidence: "The candidate now satisfies this goal." })), regions: [], successes: [{ criterionId: "goal-1", note: "The headline now leads the reading order." }], regressions: [], summary: "The candidate strongly matches the editorial direction." });
    expect(await screen.findByText("Kept pass 2")).toBeInTheDocument();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-7" }) })));
    finishTurn("evolve-director-7", { verdict: "satisfied", preference: "not_applicable", confidence: .92, criteria: criteria.map((criterion) => ({ ...criterion, status: "met", evidence: "Independent verification confirms this goal." })), regions: [], successes: [{ criterionId: "goal-1", note: "The editorial hierarchy is clear." }], regressions: [], summary: "Independent verification found no material gap." });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "mcpServer/tool/call", params: expect.objectContaining({ tool: "operations_preview_commit" }) })));
    expect(await screen.findByText("Built a more balanced editorial hierarchy.")).toBeInTheDocument();
    expect(await screen.findByText(/Two fresh directors agreed/)).toBeInTheDocument();
    expect(await screen.findByText(/1 candidate kept, 1 discarded/)).toBeInTheDocument();
    expect(await screen.findByPlaceholderText("Ask anything about this design")).toBeEnabled();
    const parentThread = invokeMock.mock.calls.find(([, args]) => args?.method === "thread/start" && args?.params?.serviceName === "figmaboy");
    expect(parentThread?.[1]?.params).not.toHaveProperty("ephemeral", true);
    const injected = invokeMock.mock.calls.filter(([, args]) => args?.method === "thread/inject_items");
    expect(injected).toHaveLength(2);
    expect(injected[0]?.[1]?.params).toMatchObject({
      threadId: "thread",
      items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "/evolve Make it more editorial" }] }],
    });
    expect(injected[1]?.[1]?.params).toMatchObject({
      threadId: "thread",
      items: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: expect.stringContaining("Built a more balanced editorial hierarchy.") }] }],
    });
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "thread/name/set", params: expect.objectContaining({ threadId: "thread", name: "Make it more editorial" }) }));
  });

  it("stops a hidden evolve turn without waiting for a visible chat turn", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Tighten the hierarchy" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/interrupt", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    expect(await screen.findByPlaceholderText("Ask anything about this design")).toBeEnabled();
  });

  it("recovers a transient specialist network failure on a fresh hidden thread", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Tighten the hierarchy" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));

    eventHandlers.get("codex-event")?.({
      payload: { method: "turn/completed", params: { threadId: "evolve-director-1", turn: { id: "evolve-director-1-turn", status: "failed", items: [], error: { message: "Network error" } } } },
    });

    expect(await screen.findByText("Connection lost. Trying again with a fresh agent.")).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-2" }) })), { timeout: 4_000 });
    expect(screen.getAllByText("Reviewing the current design")).toHaveLength(1);
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
    expect(await screen.findByPlaceholderText("Ask anything about this design")).toBeEnabled();
  });

  it("returns malformed nested JSON to the same designer for correction", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const finishTurn = (threadId: string, value: Record<string, unknown>) => {
      eventHandlers.get("codex-event")?.({ payload: { method: "item/completed", params: { threadId, turnId: `${threadId}-turn`, item: { id: `${threadId}-answer`, type: "agentMessage", text: JSON.stringify(value) } } } });
      eventHandlers.get("codex-event")?.({ payload: { method: "turn/completed", params: { threadId, turn: { id: `${threadId}-turn`, status: "completed", items: [] } } } });
    };
    const criteria = [
      { id: "goal-1", requirement: "Strengthen the primary reading order", status: "unmet", evidence: "The headline needs more visual authority." },
      { id: "goal-2", requirement: "Keep supporting content readable", status: "met", evidence: "The supporting content remains legible." },
    ];
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Strengthen the hierarchy" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    finishTurn("evolve-director-1", {
      verdict: "revise", preference: "not_applicable", confidence: .9, criteria,
      regions: [{ criterionId: "goal-1", x: 40, y: 40, width: 700, height: 180, priority: 1, note: "The headline lacks enough visual authority.", desiredOutcome: "Make the headline the clear first reading point." }],
      successes: [{ criterionId: "goal-2", note: "Supporting content is already readable." }], regressions: [], summary: "The hierarchy needs one focused change.",
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-designer-2" }) })));
    finishTurn("evolve-designer-2", { updates: [{ id: "headline", patchJson: "{" }], creates: [], reorders: [], removeCreatedIds: [], summary: "Raised the headline emphasis." });

    await waitFor(() => {
      const turns = invokeMock.mock.calls.filter(([, args]) => args?.method === "turn/start" && args?.params?.threadId === "evolve-designer-2");
      expect(turns).toHaveLength(2);
      expect(turns[1]?.[1]?.params?.input?.[0]?.text).toContain("EXACT FIGMABOY VALIDATION ERROR");
      expect(turns[1]?.[1]?.params?.input?.[0]?.text).toContain("patchJson and nodeJson must each contain exactly one valid JSON object");
    });
    finishTurn("evolve-designer-2", { updates: [{ id: "headline", patchJson: JSON.stringify({ x: 96, fontSize: 72 }) }], creates: [], reorders: [], removeCreatedIds: [], summary: "Corrected the headline hierarchy." });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "mcpServer/tool/call", params: expect.objectContaining({ tool: "operations_preview", arguments: expect.objectContaining({ operations: [{ kind: "update", id: "headline", patch: { x: 96, fontSize: 72 } }] }) }) })));
    expect(screen.queryByText("Discarded pass 1")).not.toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-3" }) })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("returns canvas validation errors to the same designer without discarding the pass", async () => {
    evolveFixture.previewErrors.push("Node evolve_hero_aura layer blur must be a finite number");
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const finishTurn = (threadId: string, value: Record<string, unknown>) => {
      eventHandlers.get("codex-event")?.({ payload: { method: "item/completed", params: { threadId, turnId: `${threadId}-turn`, item: { id: `${threadId}-answer`, type: "agentMessage", text: JSON.stringify(value) } } } });
      eventHandlers.get("codex-event")?.({ payload: { method: "turn/completed", params: { threadId, turn: { id: `${threadId}-turn`, status: "completed", items: [] } } } });
    };
    const criteria = [
      { id: "goal-1", requirement: "Create a softer material hierarchy", status: "unmet", evidence: "The hero treatment remains visually flat." },
      { id: "goal-2", requirement: "Preserve the existing readable content", status: "met", evidence: "All current text remains readable." },
    ];
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Add a softer material hierarchy" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    finishTurn("evolve-director-1", {
      verdict: "revise", preference: "not_applicable", confidence: .9, criteria,
      regions: [{ criterionId: "goal-1", x: 30, y: 30, width: 900, height: 260, priority: 1, note: "The hero lacks material separation from the page.", desiredOutcome: "Give the hero a softer sense of depth." }],
      successes: [{ criterionId: "goal-2", note: "The existing content is already readable." }], regressions: [], summary: "The hero needs one material-depth pass.",
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-designer-2" }) })));
    finishTurn("evolve-designer-2", { updates: [{ id: "headline", patchJson: JSON.stringify({ effects: [{ type: "layer-blur", blur: null }] }) }], creates: [], reorders: [], removeCreatedIds: [], summary: "Added a softer hero treatment." });

    expect(await screen.findByText(/Canvas rejected the proposal: Node evolve_hero_aura layer blur must be a finite number/)).toBeInTheDocument();
    await waitFor(() => {
      const turns = invokeMock.mock.calls.filter(([, args]) => args?.method === "turn/start" && args?.params?.threadId === "evolve-designer-2");
      expect(turns).toHaveLength(2);
      expect(turns[1]?.[1]?.params?.input?.[0]?.text).toContain("Node evolve_hero_aura layer blur must be a finite number");
      expect(turns[1]?.[1]?.params?.input?.[0]?.text).toContain('LayerBlurEffect { type: "layer-blur"; radius: number');
    });
    finishTurn("evolve-designer-2", { updates: [{ id: "headline", patchJson: JSON.stringify({ effects: [{ type: "layer-blur", radius: 18 }] }) }], creates: [], reorders: [], removeCreatedIds: [], summary: "Corrected the soft hero treatment." });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "mcpServer/tool/call", params: expect.objectContaining({ tool: "operations_preview", arguments: expect.objectContaining({ operations: [{ kind: "update", id: "headline", patch: { effects: [{ type: "layer-blur", radius: 18 }] } }] }) }) })));
    expect(screen.queryByText("Discarded pass 1")).not.toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-3" }) })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("retries a stopped evolution without duplicating its user message", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Tighten the hierarchy" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    eventHandlers.get("codex-event")?.({
      payload: { method: "turn/completed", params: { threadId: "evolve-director-1", turn: { id: "evolve-director-1-turn", status: "failed", items: [], error: { message: "Specialist returned invalid output" } } } },
    });
    await fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-2" }) })));
    expect(screen.getAllByText("/evolve Tighten the hierarchy")).toHaveLength(1);
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("finishes without a designer after two directors approve the existing frame", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "/evolve Preserve this restrained editorial direction" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const criteria = [
      { id: "goal-1", requirement: "Keep the restrained editorial hierarchy", status: "met", evidence: "The current frame already has a clear restrained hierarchy." },
      { id: "goal-2", requirement: "Preserve readable supporting copy", status: "met", evidence: "The supporting copy is readable and balanced." },
    ];
    const approve = (threadId: string) => {
      const value = { verdict: "satisfied", preference: "not_applicable", confidence: .9, criteria, regions: [], successes: [{ criterionId: "goal-1", note: "The direction is already coherent." }], regressions: [], summary: "No material change would improve the requested direction." };
      eventHandlers.get("codex-event")?.({ payload: { method: "item/completed", params: { threadId, turnId: `${threadId}-turn`, item: { id: `${threadId}-answer`, type: "agentMessage", text: JSON.stringify(value) } } } });
      eventHandlers.get("codex-event")?.({ payload: { method: "turn/completed", params: { threadId, turn: { id: `${threadId}-turn`, status: "completed", items: [] } } } });
    };
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-1" }) })));
    approve("evolve-director-1");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start", params: expect.objectContaining({ threadId: "evolve-director-2" }) })));
    approve("evolve-director-2");
    expect(await screen.findByText("The direction was already satisfied.")).toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([, args]) => args?.method === "thread/start" && String(args?.params?.serviceName).includes("designer"))).toBe(false);
    expect(invokeMock.mock.calls.some(([, args]) => args?.method === "mcpServer/tool/call" && args?.params?.tool === "operations_preview_commit")).toBe(false);
  });

  it("shows the access scope in an approval card", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "Export the design" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(eventHandlers.has("codex-event")).toBe(true));

    eventHandlers.get("codex-event")?.({
      payload: {
        id: 42,
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "tool",
          cwd: "/tmp/figmaboy",
          reason: "Save the exported files",
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ["/assets"], write: ["/exports"] },
          },
        },
      },
    });

    expect(await screen.findByText("Grant extra access?")).toBeInTheDocument();
    expect(screen.getByText("Save the exported files.")).toBeInTheDocument();
    expect(screen.getByText("Use the network")).toBeInTheDocument();
    expect(screen.getByText("Read: /assets")).toBeInTheDocument();
    expect(screen.getByText("Change: /exports")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_respond", expect.objectContaining({
      id: 42,
      result: expect.objectContaining({ scope: "turn" }),
    })));
  });

  it("shows current context separately from cumulative thread usage", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "Rate this design" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start" })));
    eventHandlers.get("codex-event")?.({
      payload: {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread",
          turnId: "turn",
          tokenUsage: {
            total: { totalTokens: 1_015_449, inputTokens: 1_006_691, cachedInputTokens: 931_072, outputTokens: 8_758, reasoningOutputTokens: 3_014 },
            last: { totalTokens: 78_171, inputTokens: 77_963, cachedInputTokens: 75_136, outputTokens: 208, reasoningOutputTokens: 104 },
            modelContextWindow: 828_400,
          },
        },
      },
    });
    const meter = await screen.findByRole("button", { name: "Context window 9% used" });
    await fireEvent.click(meter);
    expect(screen.getByText("78k of 828k tokens")).toBeInTheDocument();
    expect(screen.getByText("1.0m tokens")).toBeInTheDocument();
  });

  it("shows each skill name once without descriptions", async () => {
    skillFixture.push(
      { name: "agents-sdk", path: "/one", description: "First long description" },
      { name: "agents-sdk", path: "/two", description: "Second long description" },
    );
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    await screen.findByPlaceholderText("Ask anything about this design");
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(screen.getByRole("textbox", { name: "Message Codex" }), { target: { value: "$" } });
    expect(await screen.findAllByText("$agents-sdk")).toHaveLength(1);
    expect(screen.queryByText(/long description/i)).not.toBeInTheDocument();
  });

  it("sends a selected skill once as a structured composer attachment", async () => {
    skillFixture.push({ name: "first-principles-ui", path: "/skills/first-principles-ui" });
    const view = render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.input(textbox, { target: { value: "$first" } });
    await fireEvent.click(await screen.findByRole("option", { name: "$first-principles-ui" }));
    expect(textbox).toHaveValue("$first-principles-ui ");
    expect(view.container.querySelector(".prompt-skill")).toHaveTextContent("$first-principles-ui");
    expect(view.container.querySelector(".prompt-skill svg")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove First Principles UI skill" })).not.toBeInTheDocument();

    await fireEvent.input(textbox, { target: { value: "before $fir after" } });
    (textbox as HTMLTextAreaElement).setSelectionRange(11, 11);
    await fireEvent.select(textbox);
    await fireEvent.click(await screen.findByRole("option", { name: "$first-principles-ui" }));
    expect(textbox).toHaveValue("before $first-principles-ui after");

    await fireEvent.input(textbox, { target: { value: "- First" } });
    (textbox as HTMLTextAreaElement).setSelectionRange(7, 7);
    await fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(textbox).toHaveValue("- First\n- "));

    await fireEvent.input(textbox, { target: { value: "## Goal\n- Improve hierarchy with $first-principles-ui" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/start" })));
    const turnStart = invokeMock.mock.calls.find(([, args]) => args?.method === "turn/start");
    expect(turnStart?.[1]?.params?.input).toEqual([
      { type: "text", text: "## Goal\n- Improve hierarchy with $first-principles-ui", text_elements: [] },
      { type: "skill", name: "first-principles-ui", path: "/skills/first-principles-ui" },
    ]);
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("First Principles UI")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(clipboardWriteMock).toHaveBeenCalledWith("## Goal\n- Improve hierarchy with $first-principles-ui");
  });

  it("migrates a detached legacy draft skill into the prompt", async () => {
    skillFixture.push({ name: "first-principles-ui", path: "/skills/first-principles-ui" });
    uiStateFixture.value = {
      drafts: {
        __new__: {
          prompt: "Improve the hierarchy",
          attachments: [],
          skills: [{ name: "first-principles-ui", path: "/skills/first-principles-ui" }],
        },
      },
    };
    const view = render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await waitFor(() => expect(textbox).toHaveValue("$first-principles-ui Improve the hierarchy"));
    await waitFor(() => expect(view.container.querySelector(".prompt-skill")).toHaveTextContent("$first-principles-ui"));
  });

  it("attaches an image pasted from clipboard items", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    const image = new File([new Uint8Array([137, 80, 78, 71])], "", { type: "image/png" });
    await fireEvent.paste(textbox, {
      clipboardData: {
        files: [],
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_attachment_save", expect.objectContaining({
      workspaceId: "file",
      name: expect.stringMatching(/^pasted-image-\d+\.png$/),
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })));
    expect(await screen.findByTitle(/^pasted-image-\d+\.png$/)).toBeInTheDocument();
  });

  it("reads the Linux image clipboard before WebKit requests text", async () => {
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
    await screen.findByRole("button", { name: /GPT Test/ });
    await fireEvent.keyDown(textbox, { key: "v", ctrlKey: true });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_clipboard_read"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_attachment_save", expect.objectContaining({
      workspaceId: "file",
      name: "native-paste.png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    })));
    expect(await screen.findByTitle("native-paste.png")).toBeInTheDocument();
  });

  it("lists stored Figmaboy threads from current and legacy app-server sources", async () => {
    threadFixture.push({
      id: "stored-thread",
      preview: "Tighten the layout",
      name: "Persisted design chat",
      createdAt: 10,
      updatedAt: 20,
      recencyAt: 20,
      cwd: "/tmp/figmaboy",
      status: { type: "notLoaded" },
    });
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    expect(await screen.findByText("Persisted design chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all (1)" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/list",
      params: expect.objectContaining({
        cwd: "/tmp/figmaboy",
        sourceKinds: ["appServer", "vscode", "cli", "unknown"],
      }),
    }));
    await fireEvent.click(screen.getByText("Persisted design chat"));
    expect(await screen.findByText("Previous user request")).toBeInTheDocument();
    expect(await screen.findByText("Previous assistant reply")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(clipboardWriteMock).toHaveBeenCalledWith("Previous user request");
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/resume",
      params: expect.objectContaining({ threadId: "stored-thread" }),
    }));
  });

  it("hydrates an injected evolve transcript from its persistent parent thread", async () => {
    threadFixture.push({
      id: "evolve-parent",
      preview: "/evolve Make it editorial",
      name: "Make it editorial",
      createdAt: 10,
      updatedAt: 20,
      cwd: "/tmp/figmaboy",
      status: { type: "notLoaded" },
      emptyTurns: true,
    });
    threadItemsFixture.push(
      { turnId: "injected-1", item: { id: "evolve-user", type: "userMessage", content: [{ type: "text", text: "/evolve Make it editorial", text_elements: [] }] } },
      { turnId: "injected-1", item: { id: "evolve-result", type: "agentMessage", text: "Evolved in 4 passes. Three candidates kept." } },
    );
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    await fireEvent.click(await screen.findByText("Make it editorial"));
    expect(await screen.findByText("/evolve Make it editorial")).toBeInTheDocument();
    expect(await screen.findByText("Evolved in 4 passes. Three candidates kept.")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/items/list",
      params: expect.objectContaining({ threadId: "evolve-parent", sortDirection: "asc" }),
    }));
  });

  it("restores the last selected thread for the current design page", async () => {
    threadFixture.push(
      { id: "thread-page-one", preview: "Page one", name: "Page one chat", createdAt: 10, updatedAt: 20, cwd: "/tmp/figmaboy", status: { type: "notLoaded" } },
      { id: "thread-page-two", preview: "Page two", name: "Page two chat", createdAt: 11, updatedAt: 21, cwd: "/tmp/figmaboy", status: { type: "notLoaded" } },
    );
    uiStateFixture.value = { lastThreadId: "thread-page-two", lastThreadIdByPage: { "page-1": "thread-page-one" } };
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    await screen.findByText("Previous assistant reply");
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/resume",
      params: expect.objectContaining({ threadId: "thread-page-one" }),
    }));
  });
});
