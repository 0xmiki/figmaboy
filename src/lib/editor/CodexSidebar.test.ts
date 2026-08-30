import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { eventHandlers, invokeMock, listenMock, skillFixture, threadFixture, uiStateFixture } = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  skillFixture: [] as Array<{ name: string; path: string; description?: string }>,
  threadFixture: [] as Array<Record<string, unknown>>,
  uiStateFixture: { value: null as unknown },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import CodexSidebar from "$lib/editor/CodexSidebar.svelte";

describe("Codex sidebar diagnostics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockClear();
    eventHandlers.clear();
    skillFixture.splice(0);
    threadFixture.splice(0);
    uiStateFixture.value = null;
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
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "codex_ui_state_read") return uiStateFixture.value;
      if (command === "codex_connect") return { workspaceId: "file", cwd: "/tmp/figmaboy", reused: false };
      if (command === "codex_mcp_status") return { installed: false, healthy: false, matchesBundled: false, command: null, bundledPath: "/tmp/figmaboy-mcp" };
      if (command === "codex_mcp_install") return { installed: true, healthy: true, matchesBundled: true, command: "/tmp/figmaboy-mcp", bundledPath: "/tmp/figmaboy-mcp" };
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
            turns: [{
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
      if (args?.method === "skills/list") return { data: [{ cwd: "/tmp/figmaboy", skills: skillFixture }] };
      if (args?.method === "thread/start") {
        return {
          thread: { id: "thread", preview: "", name: null, createdAt: 1, updatedAt: 1, cwd: "/tmp/figmaboy", turns: [] },
          model: "gpt-test",
          reasoningEffort: null,
          serviceTier: null,
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
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
    await fireEvent.input(textbox, { target: { value: "Make it denser" } });
    await fireEvent.click(screen.getByRole("button", { name: "Steer Codex" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({ method: "turn/steer", params: expect.objectContaining({ expectedTurnId: "turn" }) })));
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
    expect(invokeMock).toHaveBeenCalledWith("codex_request", expect.objectContaining({
      method: "thread/resume",
      params: expect.objectContaining({ threadId: "stored-thread" }),
    }));
  });

  it("installs the MCP from the quick command", async () => {
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
    await fireEvent.input(screen.getByRole("textbox", { name: "Message Codex" }), { target: { value: "/install" } });
    await fireEvent.click(await screen.findByText("/install-mcp"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_mcp_install"));
    expect(await screen.findByText(/now available in Codex CLI/i)).toBeInTheDocument();
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
