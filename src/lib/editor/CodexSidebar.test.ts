import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clipboardWriteMock, eventHandlers, evolveExecFixture, evolveFixture, invokeMock, listenMock, skillFixture, threadFixture, threadItemsFixture, uiStateFixture } = vi.hoisted(() => ({
  clipboardWriteMock: vi.fn(),
  eventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  evolveFixture: { thread: 0, preview: 0, render: 0, validation: 0, changeToken: 7, draft: false, previewErrors: [] as string[], validatedCandidates: new Map<string, string>() },
  evolveExecFixture: [] as Array<{ request: Record<string, any>; settled: boolean; resolve: (value: unknown) => void; reject: (cause: Error) => void }>,
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

function pendingExec(role: string, index = 0) {
  return evolveExecFixture.filter((entry) => !entry.settled && entry.request.role === role)[index];
}

function finishExec(role: string, value: unknown, index = 0) {
  const entry = pendingExec(role, index);
  if (!entry) throw new Error(`No pending ${role} exec`);
  entry.resolve({ execId: entry.request.execId, text: JSON.stringify(value), exitCode: 0 });
}

function failExec(role: string, message: string, index = 0) {
  const entry = pendingExec(role, index);
  if (!entry) throw new Error(`No pending ${role} exec`);
  entry.reject(new Error(message));
}

function revisionAssessment(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "revise", preference: "not_applicable", confidence: .9,
    criteria: [
      { id: "composition-originality", requirement: "Invent a visibly different information architecture and composition", status: "unmet", evidence: "The reconstruction has not established its own structure yet." },
      { id: "goal-1", requirement: "Create a clear visual hierarchy", status: "unmet", evidence: "The current frame has equal visual weight." },
      { id: "goal-2", requirement: "Keep supporting content readable", status: "met", evidence: "Supporting copy remains readable." },
    ],
    regions: [{ criterionId: "goal-1", x: 40, y: 40, width: 800, height: 300, priority: 1, note: "The hierarchy is too flat.", desiredOutcome: "Create one unmistakable focal point." }],
    successes: [{ criterionId: "goal-2", note: "Supporting content is readable." }], regressions: [], summary: "The reconstruction needs a stronger focal point.",
    nextObjective: { criterionIds: ["goal-1"], instruction: "Build only the primary structural region.", completionSignal: "One clearly bounded primary region is visible.", preserve: ["Keep the original headline text"] },
    ...overrides,
  };
}

function satisfiedAssessment() {
  const criteria = [
    { id: "composition-originality", requirement: "Invent a visibly different information architecture and composition", status: "met", evidence: "The reconstruction uses a distinct structure and component grammar." },
    { id: "goal-1", requirement: "Keep the restrained editorial hierarchy", status: "met", evidence: "The reconstruction has a clear restrained hierarchy." },
    { id: "goal-2", requirement: "Preserve readable supporting copy", status: "met", evidence: "The supporting copy is readable and balanced." },
  ];
  return {
    verdict: "satisfied", preference: "not_applicable", confidence: .9, criteria, regions: [],
    successes: [{ criterionId: "goal-1", note: "The direction is coherent." }], regressions: [],
    summary: "No material construction work remains.",
    nextObjective: { criterionIds: [], instruction: "No further construction is needed.", completionSignal: "Every direction criterion is visibly met.", preserve: [] },
  };
}

function designCandidate(candidateId: string, patch: Record<string, unknown>) {
  return {
    title: "Structural opening", hypothesis: "A strong opening region creates a clear first reading point.", mechanism: "single-focal-region",
    intendedTradeoff: "The reconstruction commits to one clear hierarchy before decorative detail.",
    updates: [{ id: "evolve-draft", patchJson: JSON.stringify(patch) }], creates: [], reorders: [], deletes: [], reparents: [], summary: "Built the first structural hierarchy.",
  };
}

function editorDocument(draftPatch: Record<string, unknown> = {}) {
  return { rootIds: evolveFixture.draft ? ["screen", "evolve-draft"] : ["screen"], nodes: {
    screen: { id: "screen", type: "frame", name: "Screen", parentId: null, x: 0, y: 0, width: 1440, height: 810, childIds: ["headline"] },
    headline: { id: "headline", type: "text", name: "Headline", parentId: "screen", x: 80, y: 80, width: 600, height: 100, text: "Original headline", fontSize: 64 },
    ...(evolveFixture.draft ? { "evolve-draft": { id: "evolve-draft", type: "frame", name: "Screen · Evolution", parentId: null, x: 1600, y: 0, width: 1440, height: 810, childIds: [], ...draftPatch } } : {}),
  } };
}

function localThread(id: string, name: string, user = "Previous user request", assistant = "Previous assistant reply", updatedAt = 20) {
  return {
    thread: { id, preview: user, name, createdAt: 10, updatedAt, recencyAt: updatedAt, cwd: "/tmp/figmaboy", status: { type: "notLoaded" } },
    timeline: {
      items: [
        { id: `${id}-user`, type: "userMessage", content: [{ type: "text", text: user }] },
        { id: `${id}-agent`, type: "agentMessage", text: assistant },
      ],
      activeTurnId: null,
      error: "",
      usage: null,
      turns: {},
    },
  };
}

async function startEvolution(message = "/evolve Tighten the hierarchy") {
  const onEditorRpc = async (tool: string, args: Record<string, unknown>) => {
    const response = await invokeMock("codex_request", { method: "mcpServer/tool/call", params: { threadId: "local-editor", server: "figmaboy", tool, arguments: args } });
    return tool === "frame_screenshot" ? response : response.structuredContent;
  };
  render(CodexSidebar, { workspaceId: "file", pageId: "page-1", fileName: "Untitled", visible: true, onAttentionChange: () => {}, onClose: () => {}, onEditorRpc });
  const textbox = await screen.findByRole("textbox", { name: "Message Codex" });
  await screen.findByRole("button", { name: /GPT Test/ });
  await fireEvent.input(textbox, { target: { value: message } });
  await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

describe("Codex sidebar diagnostics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clipboardWriteMock.mockReset();
    listenMock.mockClear();
    eventHandlers.clear();
    evolveFixture.thread = 0;
    evolveFixture.preview = 0;
    evolveFixture.render = 0;
    evolveFixture.validation = 0;
    evolveFixture.changeToken = 7;
    evolveFixture.draft = false;
    evolveFixture.previewErrors.splice(0);
    evolveFixture.validatedCandidates.clear();
    evolveExecFixture.splice(0);
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
      if (command === "codex_evolve_exec") return new Promise((resolve, reject) => {
        const entry = { request: (args?.request ?? {}) as Record<string, any>, settled: false, resolve: (value: unknown) => { entry.settled = true; resolve(value); }, reject: (cause: Error) => { entry.settled = true; reject(cause); } };
        evolveExecFixture.push(entry);
      });
      if (command === "codex_evolve_cancel") {
        const runId = String(args?.runId ?? "");
        const pending = evolveExecFixture.filter((entry) => !entry.settled && entry.request.runId === runId);
        pending.forEach((entry) => entry.reject(new Error("Evolution stopped")));
        return pending.length;
      }
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
      if (args?.method === "mcpServerStatus/list") return { data: [{ name: "figmaboy" }, { name: "codex_apps" }, { name: "future-virtual-provider" }], nextCursor: null };
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
        if (params.tool === "editor_status") return { content: [], structuredContent: { selectedIds: ["screen"], changeToken: evolveFixture.changeToken, pageEpoch: 0 } };
        if (params.tool === "document_get") return { content: [], structuredContent: { changeToken: evolveFixture.changeToken, pageEpoch: 0, document: editorDocument() } };
        if (params.tool === "geometry_get") return { content: [], structuredContent: { nodes: [{ id: "screen", local: { x: 0, y: 0, width: 1440, height: 810 } }] } };
        if (params.tool === "frame_screenshot") {
          const frameId = String((params.arguments as Record<string, unknown>)?.frameId ?? "");
          return { content: [{ type: "image", data: frameId === "screen" ? "reference" : `draft-${evolveFixture.render}`, mimeType: "image/png" }], structuredContent: { width: 1080, height: 608 } };
        }
        if (params.tool === "evolve_reconstruction_start") {
          evolveFixture.draft = true;
          evolveFixture.changeToken += 1;
          return { content: [], structuredContent: { runId: (params.arguments as Record<string, unknown>)?.runId, sourceFrameId: "screen", draftFrameId: "evolve-draft", frameId: "evolve-draft", pageEpoch: 0, changeToken: evolveFixture.changeToken, document: editorDocument() } };
        }
        if (params.tool === "evolve_run_start") return { content: [], structuredContent: { runId: params.arguments && (params.arguments as Record<string, unknown>).runId, frameId: "evolve-draft", pageEpoch: 0, changeToken: evolveFixture.changeToken } };
        if (params.tool === "evolve_candidate_validate") {
          const candidateId = String((params.arguments as Record<string, unknown>)?.candidateId ?? "");
          const operations = Array.isArray((params.arguments as Record<string, unknown>)?.operations) ? (params.arguments as Record<string, unknown>).operations as Array<Record<string, unknown>> : [];
          if (operations.length > 5) throw new Error("EVOLVE_PASS_TOO_LARGE: use at most 5 operations in one construction pass; split this work into a smaller visible step");
          if (operations.filter((operation) => operation.kind === "create").length > 4) throw new Error("EVOLVE_PASS_TOO_LARGE: create at most 4 layers in one construction pass; leave the remaining layers for later passes");
          const validationToken = `host-validated-${candidateId}-${++evolveFixture.validation}`;
          evolveFixture.validatedCandidates.set(candidateId, validationToken);
          return { content: [], structuredContent: { valid: true, candidateId, validationToken } };
        }
        if (params.tool === "evolve_candidate_render") {
          const previewError = evolveFixture.previewErrors.shift();
          if (previewError) throw new Error(previewError);
          evolveFixture.render += 1;
          const candidateId = String((params.arguments as Record<string, unknown>)?.candidateId ?? "");
          if ((params.arguments as Record<string, unknown>)?.validationToken !== evolveFixture.validatedCandidates.get(candidateId)) throw new Error("EVOLVE_CANDIDATE_MISSING: regenerate this candidate");
          const operations = Array.isArray((params.arguments as Record<string, unknown>)?.operations) ? (params.arguments as Record<string, unknown>).operations as Array<Record<string, unknown>> : [];
          const patch = operations.find((operation) => operation.kind === "update" && operation.id === "evolve-draft")?.patch as Record<string, unknown> | undefined;
          return { content: [], structuredContent: { imageBase64: `candidate-${evolveFixture.render}`, mimeType: "image/png", candidateId: (params.arguments as Record<string, unknown>)?.candidateId, renderedChangeToken: evolveFixture.changeToken, document: editorDocument(patch) } };
        }
        if (params.tool === "evolve_candidate_commit") { evolveFixture.changeToken += 1; return { content: [], structuredContent: { committed: true, needsReview: false, changeToken: evolveFixture.changeToken } }; }
        if (params.tool === "evolve_run_discard") return { content: [], structuredContent: { discarded: true } };
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
          thread: { id, preview: "", name: null, createdAt: 1, updatedAt: 1, cwd: "/tmp/figmaboy", turns: [], ephemeral: params.ephemeral === true || serviceName.includes("evolve") },
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
    expect(threadStart?.[1]?.params).toEqual(expect.objectContaining({ ephemeral: true, serviceName: "figmaboy" }));
    expect(threadStart?.[1]?.params?.developerInstructions).toContain("extension_stage");
    expect(threadStart?.[1]?.params?.developerInstructions).toContain("only the user may run, Keep, or Discard");
    await waitFor(() => {
      const writes = invokeMock.mock.calls.filter(([command]) => command === "codex_ui_state_write");
      const stored = writes.at(-1)?.[1]?.value?.localThreads as Record<string, unknown> | undefined;
      expect(Object.keys(stored ?? {})).toHaveLength(1);
    });

    eventHandlers.get("codex-event")?.({
      payload: { method: "turn/started", params: { threadId: "thread", turn: { id: "turn", status: "inProgress", items: [], error: null } } },
    });
    await screen.findByRole("button", { name: "Steer Codex" });
    expect(screen.getByRole("button", { name: "Stop Codex" })).toHaveTextContent("");
    await fireEvent.input(textbox, { target: { value: "Make it denser" } });
    await fireEvent.click(screen.getByRole("button", { name: "Steer Codex" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/steer", params: expect.objectContaining({ expectedTurnId: "turn" }) })));
  });

  it("completes a mocked reconstruction from duplication through final approval", async () => {
    await startEvolution("/evolve Make it more editorial");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_reconstruction_start", arguments: expect.objectContaining({ sourceFrameId: "screen" }) }),
    })));

    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    const planning = pendingExec("director")!.request;
    expect(planning).toMatchObject({ role: "director", model: "gpt-test", effort: "medium", serviceTier: "priority" });
    expect(planning.images.map((image: { name: string }) => image.name)).toEqual(["reference", "current-draft"]);
    expect(planning.prompt).toContain("smallest coherent visible nextObjective");
    expect(planning.prompt).toContain("composition-originality");
    expect(planning.prompt).toContain("The reference is a product brief, not a template");
    expect(planning.prompt).toContain("Reference content inventory");
    expect(planning.prompt).not.toContain("Frozen reference layers:");
    expect(planning.outputSchema.properties.nextObjective.required).toContain("completionSignal");
    finishExec("director", revisionAssessment());

    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    const designer = pendingExec("designer")!.request;
    expect(designer.prompt).toContain("sole designer");
    expect(designer.prompt).toContain("Do not spawn subagents");
    expect(designer.prompt).toContain("Frozen reference frame ID: screen");
    expect(designer.prompt).toContain("Writable reconstruction frame ID: evolve-draft");
    expect(designer.prompt).toContain("Figmaboy will decode and validate them before rendering");
    expect(designer.prompt).toContain("Use at most five operations and create at most four layers");
    expect(designer.prompt).toContain("Work like a painter applying one layer at a time");
    expect(designer.prompt).toContain("Treat the reference as a content inventory and product brief");
    expect(designer.prompt).toContain("Do not reuse or trace the source component boundaries");
    expect(designer.prompt).not.toContain("Frozen reference layers and exact content");
    expect(designer.images).toHaveLength(2);
    expect(evolveExecFixture.some((entry) => entry.request.role === "generation")).toBe(false);
    finishExec("designer", designCandidate("P1", { fill: { type: "solid", color: "#111111", opacity: 1 } }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_candidate_render", arguments: expect.objectContaining({ candidateId: "P1", validationToken: "host-validated-P1-1" }) }),
    })));
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    const comparison = pendingExec("director")!.request;
    expect(comparison.images.map((image: { name: string }) => image.name)).toEqual(["reference", "current-draft", "candidate"]);
    finishExec("director", revisionAssessment({ preference: "image_2", summary: "The pass establishes a stronger structural hierarchy." }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_candidate_commit", arguments: { runId: expect.any(String), candidateId: "P1" } }),
    })));
    expect(await screen.findByText("Pass 1 applied to the reconstruction")).toBeInTheDocument();
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", satisfiedAssessment());
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", satisfiedAssessment());
    expect(await screen.findByText(/Reconstructed beside the original through 1 pass/)).toBeInTheDocument();
    expect(screen.getByText("Evolution complete")).toBeInTheDocument();
    expect(evolveFixture.validation).toBe(1);
  });

  it("cancels the active reconstruction worker as one run-owned process", async () => {
    await startEvolution();
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    const runId = pendingExec("director")!.request.runId;
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_evolve_cancel", { runId }));
    expect(await screen.findByPlaceholderText("Ask anything about this design")).toBeEnabled();
  });

  it("keeps the evolution journal scrolled to the latest activity", async () => {
    await startEvolution();
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();

    finishExec("director", revisionAssessment());

    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "auto" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("retries one transient director exec and preserves the exact error", async () => {
    await startEvolution();
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    failExec("director", "Network error");
    expect(await screen.findByText("Connection lost. Trying again with a fresh agent.")).toBeInTheDocument();
    expect(screen.getByText("Attempt 1 ended: Network error")).toBeInTheDocument();
    await waitFor(() => expect(pendingExec("director")).toBeTruthy(), { timeout: 4_000 });
    expect(evolveExecFixture.filter((entry) => entry.request.role === "director")).toHaveLength(2);
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("returns an empty designer response for correction instead of ending evolution", async () => {
    await startEvolution("/evolve Build a simple terminal chat UI");
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", revisionAssessment());
    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    finishExec("designer", {
      title: "Terminal shell", hypothesis: "A restrained shell will establish the product direction.", mechanism: "terminal-window-frame",
      intendedTradeoff: "The first pass focuses on structure before visual detail.",
      updates: [], creates: [], reorders: [], deletes: [], reparents: [], summary: "Prepared the construction direction.",
    });

    await waitFor(() => expect(pendingExec("correction")).toBeTruthy());
    const correction = pendingExec("correction")!.request;
    expect(correction.prompt).toContain("Designer returned no changes");
    expect(correction.prompt).toContain("At least one operation array must contain a change");
    finishExec("correction", designCandidate("P1", { fill: { type: "solid", color: "#111111", opacity: 1 } }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_candidate_render", arguments: expect.objectContaining({ candidateId: "P1" }) }),
    })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("returns an oversized construction pass for a smaller correction", async () => {
    await startEvolution("/evolve Reconstruct this terminal interface step by step");
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", revisionAssessment());
    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    finishExec("designer", {
      title: "Whole screen", hypothesis: "Building every region at once will complete the screen.", mechanism: "full-screen-construction",
      intendedTradeoff: "This attempts too much work in one pass.",
      updates: Array.from({ length: 6 }, (_, index) => ({ id: "evolve-draft", patchJson: JSON.stringify({ radius: index }) })),
      creates: [], reorders: [], deletes: [], reparents: [], summary: "Attempted the entire reconstruction.",
    });

    await waitFor(() => expect(pendingExec("correction")).toBeTruthy());
    const correction = pendingExec("correction")!.request;
    expect(correction.prompt).toContain("EVOLVE_PASS_TOO_LARGE: use at most 5 operations");
    expect(correction.prompt).toContain("Use at most five operations and create at most four layers");
    finishExec("correction", designCandidate("P1", { fill: { type: "solid", color: "#111111", opacity: 1 } }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_candidate_render", arguments: expect.objectContaining({ candidateId: "P1" }) }),
    })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("returns a canvas error to a bounded correction worker", async () => {
    evolveFixture.previewErrors.push("Node evolve-draft layer blur must be a finite number");
    await startEvolution("/evolve Add a softer material hierarchy");
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", revisionAssessment());
    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    finishExec("designer", designCandidate("P1", { effects: [{ type: "layer-blur", radius: 18 }] }));

    await waitFor(() => expect(pendingExec("correction")).toBeTruthy());
    const correction = pendingExec("correction")!.request;
    expect(correction.prompt).toContain("Node evolve-draft layer blur must be a finite number");
    expect(correction.prompt).toContain("Correct the same construction pass");
    expect(correction.prompt).toContain("Figmaboy will validate the complete replacement before rendering");
    finishExec("correction", designCandidate("P1", { effects: [{ type: "layer-blur", radius: 18 }] }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "mcpServer/tool/call",
      params: expect.objectContaining({ tool: "evolve_candidate_render", arguments: expect.objectContaining({ operations: [{ kind: "update", id: "evolve-draft", patch: { effects: [{ type: "layer-blur", radius: 18 }] } }] }) }),
    })));
    await fireEvent.click(screen.getByRole("button", { name: "Stop Codex" }));
  });

  it("stops after two corrected proposals when the canvas keeps rejecting the pass", async () => {
    evolveFixture.previewErrors.push("Persistent render failure", "Persistent render failure", "Persistent render failure");
    await startEvolution("/evolve Build a terminal shell");
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", revisionAssessment());
    await waitFor(() => expect(pendingExec("designer")).toBeTruthy());
    finishExec("designer", designCandidate("P1", { fill: { type: "solid", color: "#111111", opacity: 1 } }));

    await waitFor(() => expect(pendingExec("correction")).toBeTruthy());
    finishExec("correction", designCandidate("P1", { fill: { type: "solid", color: "#151515", opacity: 1 } }));
    await waitFor(() => expect(pendingExec("correction")).toBeTruthy());
    finishExec("correction", designCandidate("P1", { fill: { type: "solid", color: "#181818", opacity: 1 } }));

    expect(await screen.findByText(/Construction pass 1 failed after two corrections: Persistent render failure/)).toBeInTheDocument();
    expect(evolveExecFixture.filter((entry) => entry.request.role === "correction")).toHaveLength(2);
    expect(await screen.findByPlaceholderText("Ask anything about this design")).toBeEnabled();
  });

  it("finishes after two directors approve the reconstruction", async () => {
    await startEvolution("/evolve Preserve this restrained editorial direction");
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", satisfiedAssessment());
    await waitFor(() => expect(pendingExec("director")).toBeTruthy());
    finishExec("director", satisfiedAssessment());
    expect(await screen.findByText("The reconstruction satisfies the requested direction.")).toBeInTheDocument();
    expect(screen.getByText("Evolution complete")).toBeInTheDocument();
    expect(evolveExecFixture.some((entry) => entry.request.role === "designer")).toBe(false);
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

  it("lists only Figmaboy-owned threads and ignores app-server history", async () => {
    threadFixture.push({
      id: "leaked-server-thread",
      preview: "Do not import this",
      name: "Codex history",
      createdAt: 10,
      updatedAt: 20,
      recencyAt: 20,
      cwd: "/tmp/figmaboy",
      status: { type: "notLoaded" },
    });
    uiStateFixture.value = { localThreads: { "stored-thread": localThread("stored-thread", "Persisted design chat") } };
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
    expect(screen.queryByText("Codex history")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "thread/list" }));
    await fireEvent.click(screen.getByText("Persisted design chat"));
    expect(await screen.findByText("Previous user request")).toBeInTheDocument();
    expect(await screen.findByText("Previous assistant reply")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(clipboardWriteMock).toHaveBeenCalledWith("Previous user request");
    expect(invokeMock).not.toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "thread/resume" }));
  });

  it("rehydrates a saved local transcript into a fresh ephemeral runtime thread", async () => {
    uiStateFixture.value = {
      lastThreadIdByPage: { "page-1": "evolve-parent" },
      localThreads: { "evolve-parent": localThread("evolve-parent", "Make it editorial", "/evolve Make it editorial", "Evolved in 4 passes. Three candidates kept.") },
    };
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    expect(await screen.findByText("/evolve Make it editorial")).toBeInTheDocument();
    expect(await screen.findByText("Evolved in 4 passes. Three candidates kept.")).toBeInTheDocument();
    const textbox = screen.getByRole("textbox", { name: "Message Codex" });
    await fireEvent.input(textbox, { target: { value: "Continue refining it" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/start",
      params: expect.objectContaining({ ephemeral: true, serviceName: "figmaboy" }),
    }));
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/inject_items",
      params: expect.objectContaining({ threadId: "thread", items: expect.arrayContaining([expect.objectContaining({ role: "user" }), expect.objectContaining({ role: "assistant" })]) }),
    }));
  });

  it("restores the last selected thread for the current design page", async () => {
    uiStateFixture.value = {
      lastThreadId: "thread-page-two",
      lastThreadIdByPage: { "page-1": "thread-page-one" },
      localThreads: {
        "thread-page-one": localThread("thread-page-one", "Page one chat"),
        "thread-page-two": localThread("thread-page-two", "Page two chat", "Page two request", "Page two reply", 21),
      },
    };
    render(CodexSidebar, {
      workspaceId: "file",
      pageId: "page-1",
      fileName: "Untitled",
      visible: true,
      onAttentionChange: () => {},
      onClose: () => {},
    });
    await screen.findByText("Previous assistant reply");
    expect(invokeMock).not.toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "thread/resume" }));
  });
});
