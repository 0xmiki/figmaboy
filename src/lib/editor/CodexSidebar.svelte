<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import {
    Archive, Robot as Bot, Check, CaretDown as ChevronDown, WarningCircle as CircleAlert,
    StopCircle as CircleStop, Clock as Clock3, Copy, FileImage,
    ClockCounterClockwise as History, CircleNotch as LoaderCircle, SignIn as LogIn,
    ChatText as MessageSquareText, DotsThree as MoreHorizontal, PushPin as Pin,
    PushPinSlash as PinOff, Plus, ArrowClockwise as RotateCcw,
    MagnifyingGlass as Search, ArrowUp as Send, Trash as Trash2,
    ArrowCounterClockwise as Undo2, Wrench, X,
  } from "phosphor-svelte";
  import MarkdownText from "$lib/editor/MarkdownText.svelte";
  import CodexModelPicker from "$lib/editor/CodexModelPicker.svelte";
  import CodexTraitsPicker from "$lib/editor/CodexTraitsPicker.svelte";
  import CodexContextMeter from "$lib/editor/CodexContextMeter.svelte";
  import CodexToolGroup from "$lib/editor/CodexToolGroup.svelte";
  import {
    buildDisplayTimelineRows, emptyTimeline, formatTokenCount,
    inputText, itemText, object, reduceCodexEvent,
    resolveCodexSelection, threadAttention, threadTitle, uniqueEnabledSkills,
    timelineFromThread, type CodexEvent, type CodexItem, type CodexModel,
    type CodexSelection, type CodexThread, type CodexTimeline, type CodexTurnMeta,
    type JsonObject,
  } from "$lib/codex-protocol";
  import {
    COMPOSER_COMMANDS, CONTEXT_MENTIONS, composerTrigger, draftKey,
    emptyCodexUiState, parseCodexUiState, replaceComposerTrigger,
    type CodexApprovalMode, type CodexAttachment, type CodexUiState,
    type ComposerCommand,
  } from "$lib/codex-ui-state";

  type Attention = "idle" | "working" | "approval" | "input" | "complete" | "error";
  type ConnectionState = "connecting" | "ready" | "error";
  type PendingRequest = { id: string | number; method: string; params: JsonObject };
  type Connection = { workspaceId: string; cwd: string; reused: boolean };
  type Skill = { name: string; path: string; description?: string; shortDescription?: string; enabled?: boolean };
  type McpStatus = { installed: boolean; healthy: boolean; matchesBundled: boolean; command: string | null; bundledPath: string };

  let { workspaceId, pageId, fileName, visible, onAttentionChange, onClose }: {
    workspaceId: string;
    pageId: string;
    fileName: string;
    visible: boolean;
    onAttentionChange: (attention: Attention) => void;
    onClose: () => void;
  } = $props();

  let connection = $state<ConnectionState>("connecting");
  let connectionError = $state("");
  let providerWarning = $state("");
  let setupNotice = $state("");
  let mcpStatus = $state<McpStatus | null>(null);
  let mcpInstalling = $state(false);
  let cwd = $state("");
  let account = $state<JsonObject | null | undefined>(undefined);
  let authUrl = $state("");
  let models = $state<CodexModel[]>([]);
  let skills = $state<Skill[]>([]);
  let selection = $state<CodexSelection>({ model: "", effort: "", serviceTier: "default" });
  let selectionExplicit = $state(false);
  let threads = $state<CodexThread[]>([]);
  let historyOpen = $state(false);
  let historySearch = $state("");
  let historyMenu = $state<string | null>(null);
  let currentThreadId = $state<string | null>(null);
  let timeline = $state<CodexTimeline>(emptyTimeline());
  let prompt = $state("");
  let attachments = $state<CodexAttachment[]>([]);
  let lastPrompt = $state("");
  let pendingRequests = $state<PendingRequest[]>([]);
  let requestAnswers = $state<Record<string, string[]>>({});
  let requestCustomAnswer = $state("");
  let questionIndex = $state(0);
  let pendingCollapsed = $state(false);
  let respondingRequestId = $state<string | number | null>(null);
  let rpcBusy = $state(false);
  let syncingThread = $state(false);
  let compacting = $state(false);
  let pinnedToBottom = $state(true);
  let copiedMessage = $state("");
  let dismissedTurnError = $state("");
  let suggestionIndex = $state(0);
  let expandedToolGroups = $state(new Set<string>());
  let attention = $state<Attention>("idle");
  let uiState = $state<CodexUiState>(emptyCodexUiState());
  let uiStateLoaded = $state(false);
  let saveStateTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMarkedVisitedThread = "";
  let scroller: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let attachmentInput: HTMLInputElement;
  let removeListeners: (() => void)[] = [];

  const working = $derived(Boolean(timeline.activeTurnId));
  const activeModel = $derived(models.find((model) => model.model === selection.model));
  const supportsImages = $derived(activeModel?.inputModalities?.includes("image") ?? true);
  const approvalMode = $derived(uiState.approvalMode);
  const currentThread = $derived(threads.find((thread) => thread.id === currentThreadId));
  const currentPending = $derived(pendingRequests.filter((request) => request.params.threadId === currentThreadId || (!request.params.threadId && currentThreadId)));
  const activePending = $derived(currentPending[0]);
  const activeQuestions = $derived(activePending?.method === "item/tool/requestUserInput" && Array.isArray(activePending.params.questions) ? activePending.params.questions.map(object) : []);
  const activeQuestion = $derived(activeQuestions[questionIndex]);
  const blockedByRequest = $derived(Boolean(activePending));
  const filteredThreads = $derived.by(() => threads
    .filter((thread) => threadTitle(thread).toLowerCase().includes(historySearch.trim().toLowerCase()))
    .toSorted((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || (b.recencyAt ?? b.updatedAt) - (a.recencyAt ?? a.updatedAt)));
  const recentThreads = $derived(threads.slice(0, 3));
  const trigger = $derived(composerTrigger(prompt));
  const suggestions = $derived.by(() => {
    if (!trigger) return [] as Array<{ id: string; label: string; description: string; kind: string; value: unknown }>;
    if (trigger.kind === "command") return COMPOSER_COMMANDS.filter((item) => item.label.includes(trigger.query)).map((item) => ({ id: item.id, label: item.label, description: item.description, kind: "command", value: item }));
    if (trigger.kind === "mention") return CONTEXT_MENTIONS.filter((item) => item.label.includes(trigger.query)).map((item) => ({ id: item.id, label: item.label, description: item.description, kind: "mention", value: item.label }));
    return skills.filter((skill) => skill.name.toLowerCase().includes(trigger.query)).map((skill) => ({ id: `$${skill.name}`, label: `$${skill.name}`, description: "", kind: "skill", value: skill }));
  });
  const rows = $derived(buildDisplayTimelineRows(timeline));
  const sendDisabledReason = $derived.by(() => {
    if (connection !== "ready") return "Codex is not connected";
    if (account === null) return "Sign in to Codex first";
    if (blockedByRequest) return "Resolve the pending request first";
    if (rpcBusy) return "Codex is processing the previous action";
    if (!prompt.trim() && attachments.length === 0) return "Type a message or attach an image";
    if (!selection.model) return "Choose a model";
    if (attachments.length && !supportsImages) return "The selected model does not accept images";
    return null;
  });

  function errorMessage(cause: unknown): string {
    if (typeof cause === "string") return cause;
    if (cause instanceof Error) return cause.message;
    return "Codex request failed";
  }

  function relativeAge(timestamp: number): string {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return new Date(timestamp * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  async function request<T = JsonObject>(method: string, params: JsonObject = {}): Promise<T> {
    return await invoke<T>("codex_request", { method, params });
  }

  async function requestAllModels(): Promise<CodexModel[]> {
    const result: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const response: { data: CodexModel[]; nextCursor?: string | null } = await request("model/list", { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) });
      result.push(...response.data.filter((model) => !model.hidden));
      cursor = response.nextCursor ?? null;
    } while (cursor);
    return result;
  }

  async function requestAllThreads(): Promise<CodexThread[]> {
    const result: CodexThread[] = [];
    let cursor: string | null = null;
    do {
      // Older Figmaboy app-server sessions were stored with the vscode source.
      // The per-design cwd is the ownership boundary, so accepting every
      // interactive source here recovers those threads without leaking chats
      // from other projects into this sidebar.
      const response: { data: CodexThread[]; nextCursor?: string | null } = await request("thread/list", { limit: 50, cwd, sourceKinds: ["appServer", "vscode", "cli", "unknown"], sortKey: "recency_at", sortDirection: "desc", ...(cursor ? { cursor } : {}) });
      result.push(...response.data);
      cursor = response.nextCursor ?? null;
    } while (cursor);
    return result;
  }

  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      connection = "error";
      connectionError = "The Codex sidebar runs in the Figmaboy desktop app.";
      return;
    }
    let disposed = false;
    void Promise.all([
      listen<CodexEvent>("codex-event", ({ payload }) => handleEvent(payload)),
      listen("codex-disconnected", () => {
        if (!disposed) {
          connection = "error";
          connectionError = "Codex app-server disconnected. Reconnect to continue.";
          timeline = { ...timeline, activeTurnId: null };
          setAttention("error");
        }
      }),
    ]).then((removers) => disposed ? removers.forEach((remove) => remove()) : (removeListeners = removers));
    void boot();
    return () => {
      disposed = true;
      removeListeners.forEach((remove) => remove());
      if (saveStateTimer) clearTimeout(saveStateTimer);
      void persistUiState(true);
      void invoke("codex_disconnect").catch(() => undefined);
    };
  });

  $effect(() => {
    const lastItem = timeline.items.at(-1);
    const marker = `${timeline.items.length}:${lastItem?.id ?? ""}:${lastItem ? itemText(lastItem).length + String(lastItem.aggregatedOutput ?? "").length : 0}`;
    if (!marker || !pinnedToBottom) return;
    void tick().then(() => scrollToLatest(false));
  });

  $effect(() => {
    trigger?.query;
    suggestionIndex = 0;
  });

  $effect(() => {
    if (!uiStateLoaded) return;
    prompt; attachments; selection.model; selection.effort; selection.serviceTier; selectionExplicit; uiState.approvalMode; uiState.promptStash.join("|"); uiState.pinnedThreadIds.join("|"); currentThreadId;
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => void persistUiState(), 180);
  });

  $effect(() => {
    onAttentionChange(attention);
  });

  $effect(() => {
    if (!visible) { lastMarkedVisitedThread = ""; return; }
    if (!working && !activePending && attention !== "error" && attention !== "idle") setAttention("idle");
    if (currentThreadId && currentThreadId !== lastMarkedVisitedThread) {
      lastMarkedVisitedThread = currentThreadId;
      uiState = { ...uiState, lastVisitedAt: { ...uiState.lastVisitedAt, [currentThreadId]: Date.now() } };
    }
    void tick().then(() => composer?.focus());
  });

  async function boot() {
    connection = "connecting";
    connectionError = "";
    try {
      uiState = parseCodexUiState(await invoke("codex_ui_state_read", { workspaceId }));
      models = uiState.cachedModels;
      const connected = await invoke<Connection>("codex_connect", { workspaceId });
      cwd = connected.cwd;
      const [accountResponse, loadedModels, loadedThreads, skillResponse, loadedMcpStatus] = await Promise.all([
        request<{ account: JsonObject | null }>("account/read", { refreshToken: false }),
        requestAllModels().catch((cause) => {
          if (uiState.cachedModels.length) {
            providerWarning = `Using the last saved model catalog. ${errorMessage(cause)}`;
            return uiState.cachedModels;
          }
          throw cause;
        }),
        requestAllThreads(),
        request<{ data?: Array<{ cwd?: string; skills?: Skill[] }> }>("skills/list", { cwds: [cwd] }).catch(() => ({ data: [] })),
        invoke<McpStatus>("codex_mcp_status").catch(() => null),
      ]);
      account = accountResponse.account;
      models = loadedModels;
      uiState = { ...uiState, cachedModels: loadedModels };
      threads = loadedThreads.map((thread) => ({ ...thread, isPinned: thread.isPinned || uiState.pinnedThreadIds.includes(thread.id) }));
      skills = uniqueEnabledSkills(skillResponse.data?.flatMap((entry) => entry.skills ?? []) ?? []);
      mcpStatus = loadedMcpStatus;
      const newDraft = uiState.drafts[draftKey(null)];
      selectionExplicit = newDraft?.selectionExplicit === true;
      selection = resolveCodexSelection(models, newDraft?.selection);
      prompt = newDraft?.prompt ?? "";
      attachments = newDraft?.attachments ?? [];
      const hasPageThread = Object.prototype.hasOwnProperty.call(uiState.lastThreadIdByPage, pageId);
      const preferredThreadId = hasPageThread ? uiState.lastThreadIdByPage[pageId] : uiState.lastThreadId;
      const preferredThread = threads.find((thread) => thread.id === preferredThreadId);
      if (preferredThread) await openThread(preferredThread.id);
      connectionError = "";
      connection = "ready";
      uiStateLoaded = true;
    } catch (cause) {
      connection = "error";
      connectionError = errorMessage(cause);
      setAttention("error");
    }
  }

  function setAttention(next: Attention) {
    attention = next;
  }

  function handleEvent(event: CodexEvent) {
    if ((typeof event.id === "number" || typeof event.id === "string") && event.method) {
      const supported = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval", "item/tool/requestUserInput", "mcpServer/elicitation/request"];
      if (!supported.includes(event.method)) {
        void invoke("codex_respond", { id: event.id, result: null, error: `Figmaboy does not implement ${event.method}` });
        return;
      }
      pendingRequests = [...pendingRequests, { id: event.id, method: event.method, params: object(event.params) }];
      pendingCollapsed = false;
      setAttention(event.method === "item/tool/requestUserInput" ? "input" : "approval");
      return;
    }
    const params = object(event.params);
    if (event.method === "serverRequest/resolved") {
      const requestId = params.requestId;
      pendingRequests = pendingRequests.filter((request) => request.id !== requestId);
      setAttention(working ? "working" : "idle");
    }
    if (event.method === "account/login/completed") {
      if (params.success) {
        authUrl = "";
        void request<{ account: JsonObject | null }>("account/read", { refreshToken: true }).then((response) => account = response.account);
      } else connectionError = typeof params.error === "string" ? params.error : "Sign in failed";
    }
    if (event.method === "thread/name/updated") {
      threads = threads.map((thread) => thread.id === params.threadId ? { ...thread, name: String(params.threadName ?? "") } : thread);
    }
    if (event.method === "thread/status/changed") {
      threads = threads.map((thread) => thread.id === params.threadId ? { ...thread, status: params.status as CodexThread["status"] } : thread);
    }
    if (event.method === "thread/started" && object(params.thread).id) {
      const started = object(params.thread) as CodexThread;
      if (!threads.some((thread) => thread.id === started.id)) threads = [started, ...threads];
    }
    if (event.method === "thread/archived") threads = threads.filter((thread) => thread.id !== params.threadId);
    if (event.method === "thread/deleted") threads = threads.filter((thread) => thread.id !== params.threadId);
    if (event.method === "warning") providerWarning = typeof params.message === "string" ? params.message : "";
    timeline = reduceCodexEvent(timeline, event, currentThreadId);
    if (event.method === "turn/started" && params.threadId === currentThreadId) setAttention("working");
    if (event.method === "turn/completed") {
      rpcBusy = false;
      if (params.threadId === currentThreadId) setAttention(visible ? "idle" : "complete");
      void refreshThreads();
    }
  }

  async function refreshThreads() {
    if (!cwd) return;
    try { threads = (await requestAllThreads()).map((thread) => ({ ...thread, isPinned: thread.isPinned || uiState.pinnedThreadIds.includes(thread.id) })); } catch { /* current chat remains usable */ }
  }

  function uiStateWithCurrentDraft(): CodexUiState {
    const key = draftKey(currentThreadId);
    return {
      ...uiState,
      drafts: {
        ...uiState.drafts,
        [key]: { prompt, selection, selectionExplicit, attachments: attachments.map(({ previewUrl: _, ...item }) => item) },
      },
      lastThreadId: currentThreadId,
      lastThreadIdByPage: { ...uiState.lastThreadIdByPage, [pageId]: currentThreadId },
    };
  }

  function saveCurrentDraftLocally() {
    if (!uiStateLoaded) return;
    uiState = uiStateWithCurrentDraft();
  }

  async function persistUiState(immediate = false) {
    if (!uiStateLoaded) return;
    if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
    const save = invoke("codex_ui_state_write", { workspaceId, value: uiStateWithCurrentDraft() });
    if (immediate) await save.catch(() => undefined);
    else void save.catch(() => undefined);
  }

  function loadDraft(threadId: string | null, fallback?: Partial<CodexSelection>) {
    const draft = uiState.drafts[draftKey(threadId)];
    prompt = draft?.prompt ?? "";
    attachments = draft?.attachments ?? [];
    selectionExplicit = draft?.selectionExplicit === true;
    selection = resolveCodexSelection(models, selectionExplicit ? draft?.selection : fallback ?? draft?.selection);
  }

  async function openThread(id: string) {
    if (id === currentThreadId && timeline.items.length) { historyOpen = false; return; }
    saveCurrentDraftLocally();
    historyOpen = false;
    historyMenu = null;
    syncingThread = true;
    connectionError = "";
    try {
      const resumed = await request<{ thread: CodexThread; model?: string; serviceTier?: string | null; reasoningEffort?: string | null }>("thread/resume", approvalParams({ threadId: id, cwd }));
      let thread = resumed.thread;
      if (!thread.turns?.length) thread = (await request<{ thread: CodexThread }>("thread/read", { threadId: id, includeTurns: true })).thread;
      currentThreadId = id;
      timeline = timelineFromThread(thread);
      loadDraft(id, { model: resumed.model, effort: resumed.reasoningEffort ?? "", serviceTier: resumed.serviceTier ?? "default" });
      uiState = { ...uiState, lastThreadId: id, lastThreadIdByPage: { ...uiState.lastThreadIdByPage, [pageId]: id }, lastVisitedAt: { ...uiState.lastVisitedAt, [id]: Date.now() } };
      pinnedToBottom = true;
      dismissedTurnError = "";
      await tick();
      scrollToLatest(false);
    } catch (cause) {
      connectionError = errorMessage(cause);
    } finally {
      syncingThread = false;
    }
  }

  function newChat() {
    saveCurrentDraftLocally();
    currentThreadId = null;
    timeline = emptyTimeline();
    historyOpen = false;
    historyMenu = null;
    dismissedTurnError = "";
    loadDraft(null, selection);
    void tick().then(() => composer?.focus());
  }

  function approvalParams<T extends JsonObject>(params: T): T & JsonObject {
    return { ...params, approvalPolicy: "on-request", approvalsReviewer: approvalMode === "auto" ? "auto_review" : "user", sandbox: "workspace-write" };
  }

  async function ensureThread(): Promise<string> {
    if (currentThreadId) return currentThreadId;
    const response = await request<{ thread: CodexThread; model?: string; serviceTier?: string | null; reasoningEffort?: string | null }>("thread/start", approvalParams({
      cwd,
      model: selection.model || undefined,
      serviceTier: selection.serviceTier === "default" ? null : selection.serviceTier,
      serviceName: "figmaboy",
      developerInstructions: `You are embedded in Figmaboy with the design file "${fileName}" open. Use the figmaboy MCP server to inspect and edit the open design. Resolve @selection, @current-frame, @page, and @design by inspecting the live editor. Read current state before changing it, make native editable layers, and visually inspect the result before finishing. This sidebar already loads the bundled MCP. If the user asks to connect Figmaboy to external Codex clients, tell them to run /install-mcp here. Do not change a healthy custom MCP registration. Keep chat updates concise and describe completed design changes in plain language.`,
    }));
    currentThreadId = response.thread.id;
    selection = resolveCodexSelection(models, { model: response.model ?? selection.model, effort: response.reasoningEffort ?? selection.effort, serviceTier: response.serviceTier ?? selection.serviceTier });
    threads = [response.thread, ...threads.filter((thread) => thread.id !== response.thread.id)];
    return response.thread.id;
  }

  function turnInput(text: string) {
    const inputs: JsonObject[] = [{ type: "text", text, text_elements: [] }];
    for (const attachment of attachments) inputs.push({ type: "localImage", path: attachment.path });
    for (const skill of skills) {
      if (new RegExp(`(^|\\s)\\$${skill.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?=\\s|$)`).test(text)) inputs.push({ type: "skill", name: skill.name, path: skill.path });
    }
    return inputs;
  }

  async function send(value = prompt) {
    const text = value.trim();
    if ((!text && attachments.length === 0) || connection !== "ready" || rpcBusy || account === null || blockedByRequest) return;
    const sentAttachments = attachments;
    prompt = "";
    attachments = [];
    lastPrompt = text;
    timeline = { ...timeline, error: "", items: [...timeline.items, { id: `local_${Date.now()}`, type: "userMessage", content: [{ type: "text", text: text || "Shared image reference", text_elements: [] }] }] };
    pinnedToBottom = true;
    rpcBusy = true;
    try {
      attachments = sentAttachments;
      const threadId = await ensureThread();
      const input = turnInput(text || "Use the attached image as a visual reference for the open design.");
      attachments = [];
      if (timeline.activeTurnId) {
        await request("turn/steer", { threadId, input, expectedTurnId: timeline.activeTurnId });
      } else {
        await request("turn/start", {
          threadId,
          input,
          model: selection.model,
          ...(selection.effort ? { effort: selection.effort } : {}),
          serviceTier: selection.serviceTier === "default" ? null : selection.serviceTier,
          approvalsReviewer: approvalMode === "auto" ? "auto_review" : "user",
        });
        if (timeline.items.filter((item) => item.type === "userMessage").length === 1) void renameThread(threadId, text.slice(0, 72));
      }
    } catch (cause) {
      attachments = sentAttachments;
      timeline = { ...timeline, activeTurnId: null, error: errorMessage(cause) };
      setAttention("error");
    } finally {
      rpcBusy = false;
    }
  }

  async function stop() {
    if (!currentThreadId || !timeline.activeTurnId) return;
    rpcBusy = true;
    try { await request("turn/interrupt", { threadId: currentThreadId, turnId: timeline.activeTurnId }); }
    catch (cause) { timeline = { ...timeline, error: errorMessage(cause) }; }
    finally { rpcBusy = false; }
  }

  async function runCommand(command: ComposerCommand) {
    if (command.action === "new") { newChat(); return; }
    if (command.action === "install-mcp") { await installMcp(); return; }
    if (command.action === "review") { prompt = "Review the current design, fix the most important visual issues, capture a final frame screenshot, and summarize the changes."; await send(); return; }
    if (command.action === "compact" && currentThreadId) {
      compacting = true;
      try { await request("thread/compact/start", { threadId: currentThreadId }); }
      catch (cause) { connectionError = errorMessage(cause); }
      finally { compacting = false; }
      return;
    }
    if (command.action === "save" || command.action === "undo") {
      try {
        const threadId = await ensureThread();
        await request("mcpServer/tool/call", { threadId, server: "figmaboy", tool: command.action === "save" ? "document_save" : "history_undo", arguments: {} });
      } catch (cause) { connectionError = errorMessage(cause); }
    }
  }

  async function installMcp() {
    mcpInstalling = true;
    connectionError = "";
    setupNotice = "";
    try {
      mcpStatus = await invoke<McpStatus>("codex_mcp_install");
      setupNotice = mcpStatus.matchesBundled
        ? "Figmaboy is now available in Codex CLI, the IDE extension, and the ChatGPT desktop app. Start a new Codex session to load it."
        : "Figmaboy was already registered with Codex, so the existing working setup was kept."
    } catch (cause) {
      connectionError = errorMessage(cause);
    } finally {
      mcpInstalling = false;
    }
  }

  function chooseSuggestion(suggestion: (typeof suggestions)[number]) {
    if (!trigger) return;
    if (suggestion.kind === "command") { prompt = ""; void runCommand(suggestion.value as ComposerCommand); return; }
    const replacement = suggestion.kind === "skill" ? `$${(suggestion.value as Skill).name}` : String(suggestion.value);
    prompt = replaceComposerTrigger(prompt, trigger.start, replacement);
    void tick().then(() => composer?.focus());
  }

  async function addAttachmentFiles(files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) { connectionError = `${file.name} is not an image.`; continue; }
      try {
        const dataUrl = await readFileDataUrl(file);
        const saved = await invoke<{ path: string; mime: string; name: string }>("codex_attachment_save", { workspaceId, name: file.name, dataUrl });
        attachments = [...attachments, { id: crypto.randomUUID(), ...saved, previewUrl: dataUrl }];
      } catch (cause) { connectionError = errorMessage(cause); }
    }
  }

  function readFileDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); void addAttachmentFiles(files); }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    void addAttachmentFiles([...(event.dataTransfer?.files ?? [])]);
  }

  async function login() {
    try {
      const response = await request<{ authUrl?: string }>("account/login/start", { type: "chatgpt", codexStreamlinedLogin: true, useHostedLoginSuccessPage: true, appBrand: "codex" });
      authUrl = response.authUrl ?? "";
      if (authUrl) window.open(authUrl, "_blank", "noopener,noreferrer");
    } catch (cause) { connectionError = errorMessage(cause); }
  }

  function decisionResult(request: PendingRequest, decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    if (request.method === "item/permissions/requestApproval") {
      if (decision === "decline" || decision === "cancel") return { permissions: {}, scope: "turn" };
      const permissions = object(request.params.permissions);
      return { permissions: { ...(permissions.network ? { network: permissions.network } : {}), ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}) }, scope: decision === "acceptForSession" ? "session" : "turn" };
    }
    if (request.method === "mcpServer/elicitation/request") return { action: decision === "accept" || decision === "acceptForSession" ? "accept" : decision, content: null, _meta: null };
    return { decision };
  }

  async function answerRequest(request: PendingRequest, decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    respondingRequestId = request.id;
    try {
      await invoke("codex_respond", { id: request.id, result: decisionResult(request, decision), error: null });
      pendingRequests = pendingRequests.filter((item) => item.id !== request.id);
      setAttention(working ? "working" : "idle");
    } catch (cause) { connectionError = errorMessage(cause); }
    finally { respondingRequestId = null; }
  }

  function toggleQuestionOption(label: string) {
    if (!activeQuestion) return;
    const id = String(activeQuestion.id ?? questionIndex);
    const current = requestAnswers[id] ?? [];
    const multi = activeQuestion.multiSelect === true;
    requestAnswers = { ...requestAnswers, [id]: multi ? (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]) : [label] };
    if (!multi) setTimeout(() => void advanceQuestion(), 180);
  }

  async function advanceQuestion() {
    if (!activePending || !activeQuestion) return;
    const id = String(activeQuestion.id ?? questionIndex);
    const custom = requestCustomAnswer.trim();
    if (custom) requestAnswers = { ...requestAnswers, [id]: [custom] };
    if (!(requestAnswers[id]?.length)) return;
    requestCustomAnswer = "";
    if (questionIndex < activeQuestions.length - 1) { questionIndex += 1; return; }
    respondingRequestId = activePending.id;
    const answers = Object.fromEntries(Object.entries(requestAnswers).map(([key, value]) => [key, { answers: value }]));
    try {
      await invoke("codex_respond", { id: activePending.id, result: { answers }, error: null });
      pendingRequests = pendingRequests.filter((item) => item.id !== activePending.id);
      requestAnswers = {};
      questionIndex = 0;
      setAttention(working ? "working" : "idle");
    } catch (cause) { connectionError = errorMessage(cause); }
    finally { respondingRequestId = null; }
  }

  async function archiveThread(event: MouseEvent, id: string) {
    event.stopPropagation();
    if (threads.find((thread) => thread.id === id)?.status?.type === "active") return;
    try { await request("thread/archive", { threadId: id }); threads = threads.filter((thread) => thread.id !== id); if (currentThreadId === id) newChat(); }
    catch (cause) { connectionError = errorMessage(cause); }
  }

  async function deleteThread(event: MouseEvent, id: string) {
    event.stopPropagation();
    if (!confirm("Delete this chat permanently?")) return;
    try { await request("thread/delete", { threadId: id }); threads = threads.filter((thread) => thread.id !== id); if (currentThreadId === id) newChat(); }
    catch (cause) { connectionError = errorMessage(cause); }
  }

  async function pinThread(event: MouseEvent, thread: CodexThread) {
    event.stopPropagation();
    const pinned = !thread.isPinned;
    uiState = { ...uiState, pinnedThreadIds: pinned ? [...new Set([...uiState.pinnedThreadIds, thread.id])] : uiState.pinnedThreadIds.filter((id) => id !== thread.id) };
    threads = threads.map((item) => item.id === thread.id ? { ...item, isPinned: pinned } : item);
    historyMenu = null;
    try {
      await request("thread/metadata/update", { threadId: thread.id, isPinned: pinned });
    } catch { /* older app-server builds keep the local pin */ }
  }

  async function renameThread(id: string, suggested?: string) {
    const current = threads.find((thread) => thread.id === id);
    const name = suggested ?? promptForName(current ? threadTitle(current) : "Untitled chat");
    if (!name?.trim()) return;
    try { await request("thread/name/set", { threadId: id, name: name.trim() }); threads = threads.map((thread) => thread.id === id ? { ...thread, name: name.trim() } : thread); }
    catch (cause) { connectionError = errorMessage(cause); }
  }

  function promptForName(current: string): string | null {
    return window.prompt("Chat title", current);
  }

  function updateSelection(next: CodexSelection) {
    selectionExplicit = true;
    selection = resolveCodexSelection(models, next);
  }

  function updateApprovalMode(mode: CodexApprovalMode) {
    uiState = { ...uiState, approvalMode: mode };
  }

  function terminalAgent(item: CodexItem): boolean {
    if (item.type !== "agentMessage" || !item._turnId) return false;
    return !timeline.items.some((candidate) => candidate.type === "agentMessage" && candidate._turnId === item._turnId && timeline.items.indexOf(candidate) > timeline.items.indexOf(item));
  }

  function turnMeta(item: CodexItem): CodexTurnMeta | null {
    return item._turnId ? timeline.turns[item._turnId] ?? null : null;
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (trigger && suggestions.length) {
      if (event.key === "ArrowDown") { event.preventDefault(); suggestionIndex = Math.min(suggestions.length - 1, suggestionIndex + 1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); suggestionIndex = Math.max(0, suggestionIndex - 1); return; }
      if (event.key === "Enter" && !event.shiftKey && suggestions[suggestionIndex]) { event.preventDefault(); chooseSuggestion(suggestions[suggestionIndex]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !trigger) { event.preventDefault(); void send(); }
  }

  function onGlobalKeydown(event: KeyboardEvent) {
    if (!activeQuestion || respondingRequestId !== null || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    const index = Number.parseInt(event.key, 10) - 1;
    const options = Array.isArray(activeQuestion.options) ? activeQuestion.options.map(object) : [];
    if (index >= 0 && options[index]) { event.preventDefault(); toggleQuestionOption(String(options[index].label)); }
  }

  function onScroll() {
    if (!scroller) return;
    pinnedToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  }

  function scrollToLatest(smooth = false) {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinnedToBottom = true;
  }

  async function copyMessage(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    copiedMessage = id;
    setTimeout(() => { if (copiedMessage === id) copiedMessage = ""; }, 1400);
  }

  function threadUnread(thread: CodexThread): boolean {
    return thread.updatedAt * 1000 > (uiState.lastVisitedAt[thread.id] ?? thread.updatedAt * 1000);
  }

  function markThreadUnread(event: MouseEvent, thread: CodexThread) {
    event.stopPropagation();
    uiState = { ...uiState, lastVisitedAt: { ...uiState.lastVisitedAt, [thread.id]: 0 } };
    historyMenu = null;
  }

  function stashPrompt() {
    if (prompt.trim()) {
      uiState = { ...uiState, promptStash: [prompt, ...uiState.promptStash.filter((item) => item !== prompt)].slice(0, 20) };
      prompt = "";
      return;
    }
    const restored = uiState.promptStash[0];
    if (!restored) return;
    prompt = restored;
    uiState = { ...uiState, promptStash: uiState.promptStash.slice(1) };
    void tick().then(() => composer?.focus());
  }

  async function implementPlan(text: string, inNewChat: boolean) {
    if (inNewChat) newChat();
    prompt = `Implement this plan in the open Figmaboy design.\n\n${text}`;
    await send();
  }
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<aside class="codex-sidebar" class:visible aria-label="Codex chat" ondragover={(event) => event.preventDefault()} ondrop={onDrop}>
  <header class="sidebar-head">
    <div class="header-spacer"></div>
    {#if currentThread}<button title="Rename chat" ondblclick={() => renameThread(currentThread.id)} onclick={() => (historyMenu = historyMenu === currentThread.id ? null : currentThread.id)}><MoreHorizontal size={15} /></button>{/if}
    <button title="Chat history" class:active={historyOpen} onclick={() => (historyOpen = !historyOpen)}><History size={15} /></button>
    <button title="New chat" onclick={newChat}><Plus size={16} /></button>
    <button title="Close Codex" onclick={onClose}><X size={16} /></button>
  </header>

  {#if historyMenu && currentThread}
    <div class="header-menu"><button onclick={() => renameThread(currentThread.id)}>Rename</button><button onclick={(event) => pinThread(event, currentThread)}>{currentThread.isPinned ? "Unpin" : "Pin"}</button><button onclick={(event) => markThreadUnread(event, currentThread)}>Mark unread</button><button disabled={currentThread.status?.type === "active"} onclick={(event) => archiveThread(event, currentThread.id)}>Archive</button><button class="danger" onclick={(event) => deleteThread(event, currentThread.id)}>Delete</button></div>
  {/if}

  {#if historyOpen}
    <section class="history-panel">
      <div class="history-title"><strong>Chats</strong><button onclick={newChat}><Plus size={13} /> New chat</button></div>
      <label class="history-search"><Search size={13} /><input aria-label="Search chats" placeholder="Search chats" bind:value={historySearch} /></label>
      <div class="history-list">
        {#each filteredThreads as thread (thread.id)}
          <div class="history-row" class:current={thread.id === currentThreadId} role="button" tabindex="0" onclick={() => openThread(thread.id)} onkeydown={(event) => event.key === "Enter" && openThread(thread.id)}>
            <span class={`status ${threadAttention(thread, pendingRequests.some((request) => request.params.threadId === thread.id && request.method !== "item/tool/requestUserInput"), pendingRequests.some((request) => request.params.threadId === thread.id && request.method === "item/tool/requestUserInput"))}`}></span>
            <span class="history-copy"><strong>{threadTitle(thread)}</strong><small>{new Date(thread.updatedAt * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>
            {#if threadUnread(thread)}<i class="unread" title="Unread activity"></i>{/if}
            {#if thread.isPinned}<Pin size={11} />{/if}
            <button class="row-menu" title="Chat actions" onclick={(event) => { event.stopPropagation(); historyMenu = historyMenu === thread.id ? null : thread.id; }}><MoreHorizontal size={13} /></button>
            {#if historyMenu === thread.id}<div class="thread-menu" role="menu" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><button onclick={() => renameThread(thread.id)}>Rename</button><button onclick={(event) => pinThread(event, thread)}>{#if thread.isPinned}<PinOff size={11} />Unpin{:else}<Pin size={11} />Pin{/if}</button><button onclick={(event) => markThreadUnread(event, thread)}><Clock3 size={11} />Mark unread</button><button disabled={thread.status?.type === "active"} onclick={(event) => archiveThread(event, thread.id)}><Archive size={11} />Archive</button><button class="danger" onclick={(event) => deleteThread(event, thread.id)}><Trash2 size={11} />Delete</button></div>{/if}
          </div>
        {:else}<div class="history-empty">{historySearch.trim() ? "No chats match this search." : "No saved chats yet. Your first message starts one."}</div>{/each}
      </div>
    </section>
  {/if}

  <div class="messages" bind:this={scroller} onscroll={onScroll}>
    {#if connection === "connecting"}
      <div class="center-state"><LoaderCircle class="spin" size={22} /><strong>Starting Codex</strong><p>Connecting app-server and Figmaboy tools.</p></div>
    {:else if connection === "error"}
      <div class="center-state error"><Bot size={24} /><strong>Codex is unavailable</strong><p>{connectionError}</p><button onclick={boot}><RotateCcw size={13} /> Reconnect</button></div>
    {:else if account === null}
      <div class="center-state"><LogIn size={24} /><strong>Sign in to Codex</strong><p>Use the same ChatGPT account as the Codex app or CLI.</p><button onclick={login}><LogIn size={13} /> Sign in with ChatGPT</button>{#if authUrl}<a href={authUrl} target="_blank" rel="noreferrer">Open sign-in page</a>{/if}</div>
    {:else if !currentThreadId && timeline.items.length === 0}
      <div class="empty-chat">
        {#if recentThreads.length}
          <section class="recent-chats" aria-label="Recent chats">
            <header><span>Chats</span><button onclick={() => (historyOpen = true)}>View all ({threads.length})</button></header>
            {#each recentThreads as thread (thread.id)}
              <button class="recent-row" onclick={() => openThread(thread.id)}><span>{threadTitle(thread)}</span><time>{relativeAge(thread.recencyAt ?? thread.updatedAt)}</time></button>
            {/each}
          </section>
        {/if}
      </div>
    {:else}
      <div class="timeline">
        {#each rows as row (row.kind === "item" ? row.item.id : row.group.id)}
          {#if row.kind === "tools"}
            <CodexToolGroup group={row.group} label={row.label} expanded={expandedToolGroups.has(row.group.id)} onExpandedChange={(expanded) => { const next = new Set(expandedToolGroups); expanded ? next.add(row.group.id) : next.delete(row.group.id); expandedToolGroups = next; }} />
          {:else if row.item.type === "userMessage"}
            <div class="message user"><div>{inputText(row.item.content)}</div></div>
          {:else if row.item.type === "agentMessage"}
            <article class="message assistant"><div class="assistant-body"><MarkdownText text={String(row.item.text ?? "")} />{#if row.item.text}<button class="copy-message" title="Copy response" onclick={() => copyMessage(row.item.id, String(row.item.text))}>{#if copiedMessage === row.item.id}<Check size={13} />{:else}<Copy size={13} />{/if}</button>{/if}{#if terminalAgent(row.item) && turnMeta(row.item)?.status !== "inProgress"}<div class="turn-meta">{#if timeline.usage}<span>{formatTokenCount(timeline.usage.totalTokens)} context tokens</span>{/if}<button title="Undo the last Figmaboy change" onclick={() => runCommand(COMPOSER_COMMANDS.find((command) => command.action === "undo")!)}><Undo2 size={11} />Undo last change</button></div>{/if}</div></article>
          {:else if row.item.type === "reasoning" && itemText(row.item)}
            <details class="reasoning" open={working}><summary><LoaderCircle class={working ? "spin" : undefined} size={12} /><span>{working ? "Thinking" : "Reasoning"}</span><ChevronDown size={11} /></summary><p>{itemText(row.item)}</p></details>
          {:else if row.item.type === "plan" && itemText(row.item)}
            <details class="plan" open><summary><MessageSquareText size={12} /><span>Plan</span><ChevronDown size={11} /></summary><div><MarkdownText text={itemText(row.item)} />{#if !working}<div class="plan-actions"><button onclick={() => implementPlan(itemText(row.item), false)}>Implement</button><button onclick={() => implementPlan(itemText(row.item), true)}>Implement in new chat</button></div>{/if}</div></details>
          {/if}
        {/each}
        {#if working}<div class="working"><LoaderCircle class="spin" size={13} /> Codex is working</div>{/if}
        {#if timeline.error && dismissedTurnError !== timeline.error}<div class="turn-error"><button title="Dismiss error" onclick={() => (dismissedTurnError = timeline.error)}><X size={12} /></button><strong>Codex stopped</strong><p>{timeline.error}</p>{#if lastPrompt}<button class="retry" onclick={() => send(lastPrompt)}><RotateCcw size={12} /> Retry</button>{/if}</div>{/if}
      </div>
    {/if}
  </div>

  {#if !pinnedToBottom}<button class="jump-latest" onclick={() => scrollToLatest()}><ChevronDown size={13} /> Latest</button>{/if}

  <footer class="composer-wrap">
    {#if setupNotice}<div class="banner success"><Check size={13} /><span>{setupNotice}</span><button onclick={() => (setupNotice = "")}><X size={12} /></button></div>{/if}
    {#if providerWarning}<div class="banner warning"><CircleAlert size={13} /><span>{providerWarning}</span><button onclick={() => (providerWarning = "")}><X size={12} /></button></div>{/if}
    {#if connectionError && connection === "ready"}<div class="banner error"><CircleAlert size={13} /><span>{connectionError}</span><button onclick={() => (connectionError = "")}><X size={12} /></button></div>{/if}
    {#if syncingThread}<div class="sync-pill"><LoaderCircle class="spin" size={12} />Syncing chat…</div>{/if}

    {#if activePending}
      <section class="pending-card">
        {#if activePending.method === "item/tool/requestUserInput" && activeQuestion}
          <header><MessageSquareText size={13} /><strong>{String(activeQuestion.header ?? "Codex needs your input")}</strong>{#if activeQuestions.length > 1}<span>{questionIndex + 1}/{activeQuestions.length}</span>{/if}<button class="collapse-pending" title={pendingCollapsed ? "Show question" : "Hide question"} onclick={() => (pendingCollapsed = !pendingCollapsed)}><ChevronDown class={pendingCollapsed ? "rotated" : undefined} size={12} /></button></header>
          {#if pendingCollapsed}<p class="collapsed-question">{String(activeQuestion.question ?? "")}</p>{:else}<p>{String(activeQuestion.question ?? "")}</p>
            <div class="answer-options">{#each Array.isArray(activeQuestion.options) ? activeQuestion.options.map(object) : [] as option, index}<button class:selected={(requestAnswers[String(activeQuestion.id ?? questionIndex)] ?? []).includes(String(option.label))} disabled={respondingRequestId === activePending.id} onclick={() => toggleQuestionOption(String(option.label))}><span><strong>{String(option.label)}</strong>{#if option.description && option.description !== option.label}<small>{String(option.description)}</small>{/if}</span><kbd>{index < 9 ? index + 1 : ""}</kbd></button>{/each}</div>
            <input class="custom-answer" placeholder="Or type your own answer" bind:value={requestCustomAnswer} />
            <div class="pending-actions"><button onclick={() => answerRequest(activePending, "cancel")}>Cancel</button><button class="approve" disabled={respondingRequestId === activePending.id || (!(requestAnswers[String(activeQuestion.id ?? questionIndex)]?.length) && !requestCustomAnswer.trim())} onclick={advanceQuestion}>{questionIndex < activeQuestions.length - 1 ? "Next" : "Continue"}</button></div>{/if}
        {:else}
          <header><Wrench size={13} /><strong>{activePending.method.includes("commandExecution") ? "Run this command?" : activePending.method.includes("fileChange") ? "Allow this file change?" : activePending.method.includes("permissions") ? "Grant extra access?" : "Codex needs approval"}</strong>{#if currentPending.length > 1}<span>1/{currentPending.length}</span>{/if}</header>
          <p>{String(activePending.params.reason ?? "Review this action before Codex continues.")}</p>{#if activePending.params.command}<pre>{String(activePending.params.command)}</pre>{/if}
          <div class="pending-actions"><button disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "cancel")}>Cancel</button><button class="decline" disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "decline")}>Decline</button><button disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "acceptForSession")}>Always allow</button><button class="approve" disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "accept")}>Approve</button></div>
        {/if}
      </section>
    {/if}

    <div class="composer" class:disabled={connection !== "ready" || account === null || blockedByRequest}>
      {#if attachments.length}<div class="attachment-strip">{#each attachments as attachment (attachment.id)}<div>{#if attachment.previewUrl}<img src={attachment.previewUrl} alt="" />{:else}<FileImage size={15} />{/if}<span title={attachment.name}>{attachment.name}</span><button title="Remove attachment" onclick={() => (attachments = attachments.filter((item) => item.id !== attachment.id))}><X size={11} /></button></div>{/each}</div>{/if}
      <textarea aria-label="Message Codex" bind:this={composer} bind:value={prompt} onkeydown={onComposerKeydown} onpaste={onPaste} placeholder={blockedByRequest ? "Resolve the request above to continue" : working ? "Steer Codex while it works…" : "Ask anything about this design"} rows="1" disabled={connection !== "ready" || account === null || blockedByRequest}></textarea>
      {#if trigger && suggestions.length}<div class="command-menu">{#each suggestions as suggestion, index}<button class:highlighted={index === suggestionIndex} class:skill-row={suggestion.kind === "skill"} onmouseenter={() => (suggestionIndex = index)} onclick={() => chooseSuggestion(suggestion)}><strong>{suggestion.label}</strong>{#if suggestion.description}<span>{suggestion.description}</span>{/if}</button>{/each}</div>{/if}
      <div class="composer-controls">
        <input bind:this={attachmentInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onchange={(event) => { void addAttachmentFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
        <button class="attach" aria-label="Attach image" title={supportsImages ? "Attach image" : "This model does not accept images"} disabled={blockedByRequest || !supportsImages} onclick={() => attachmentInput.click()}><Plus size={16} /></button>
        <button class="stash" aria-label="Prompt stash" title={prompt.trim() ? "Stash this prompt" : uiState.promptStash.length ? `Restore stashed prompt (${uiState.promptStash.length})` : "No stashed prompts"} disabled={!prompt.trim() && !uiState.promptStash.length} onclick={stashPrompt}><Clock3 size={14} /></button>
        <span class="control-spacer"></span>
        <CodexModelPicker {models} selected={selection.model} disabled={working || rpcBusy} onSelect={(model) => updateSelection({ ...selection, model })} />
        <CodexTraitsPicker model={activeModel} {selection} {approvalMode} disabled={working || rpcBusy} onChange={updateSelection} onApprovalModeChange={updateApprovalMode} />
        {#if timeline.usage}<CodexContextMeter usage={timeline.usage} {compacting} onCompact={() => runCommand(COMPOSER_COMMANDS.find((command) => command.action === "compact")!)} />{/if}
        {#if working}<button class="stop" aria-label="Stop Codex" title="Stop Codex" disabled={rpcBusy} onclick={stop}><CircleStop size={15} /></button>{/if}
        <button class="send" aria-label={working ? "Steer Codex" : "Send message"} title={sendDisabledReason ?? (working ? "Steer Codex" : "Send (Enter)")} disabled={sendDisabledReason !== null} onclick={() => send()}>{#if rpcBusy}<LoaderCircle class="spin" size={14} />{:else}<Send size={15} weight="bold" />{/if}</button>
      </div>
    </div>
    <div class="footer-meta"><span>{working ? "You can steer the active turn" : "Working locally"}</span><kbd>Shift ↵ newline</kbd></div>
  </footer>
</aside>

<style>
  .codex-sidebar { position: absolute; z-index: 31; inset: 0 0 0 auto; width: var(--codex-panel-width,390px); display: none; flex-direction: column; overflow: visible; background: #222224; border-left: 1px solid #414146; color: #ececef; box-shadow: -8px 0 24px #0002; }.codex-sidebar.visible { display: flex; }
  .sidebar-head { height: 42px; flex: 0 0 42px; display: flex; align-items: center; gap: 2px; padding: 0 8px; border-bottom: 1px solid #3a3a3f; background: #272729; }.header-spacer { flex: 1; }.sidebar-head > button { width: 31px; height: 31px; border: 0; border-radius: 6px; background: transparent; color: #9999a1; display: grid; place-items: center; cursor: pointer; }.sidebar-head > button:hover,.sidebar-head > button.active { color: white; background: #39393e; }.header-menu { position: absolute; z-index: 40; top: 38px; right: 70px; width: 138px; padding: 5px; border: 1px solid #46464d; border-radius: 7px; background: #29292d; box-shadow: 0 12px 35px #000a; }.header-menu button,.thread-menu button { width: 100%; height: 31px; border: 0; border-radius: 4px; background: transparent; color: #ddd; text-align: left; cursor: pointer; font-size: var(--text-control); }.header-menu button:hover,.thread-menu button:hover { background: #3b3b41; }.header-menu .danger,.thread-menu .danger { color: #fca5a5; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #4b4b51 transparent; }.timeline { padding: 19px 18px 32px; display: flex; flex-direction: column; gap: 8px; }
  .center-state { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; text-align: center; color: #9999a2; }.center-state strong { color: #ededf0; font-size: var(--text-emphasis); }.center-state p { max-width: 245px; margin: 6px 0 14px; font-size: var(--text-small); line-height: var(--leading-body); }.center-state button,.center-state a { min-height: 31px; padding: 0 11px; border: 1px solid #4b4b52; border-radius: 6px; background: #333338; color: white; display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--text-small); text-decoration: none; }.center-state a { margin-top: 7px; background: transparent; }
  .empty-chat { min-height: 100%; position: relative; display: flex; flex-direction: column; }.recent-chats { padding: 16px 13px 0; }.recent-chats header { height: 24px; display: flex; align-items: center; justify-content: space-between; color: #8b8b92; font-size: var(--text-control); }.recent-chats header button { border: 0; background: transparent; color: #696970; cursor: pointer; font: inherit; }.recent-chats header button:hover { color: #c5c5ca; }.recent-row { width: 100%; height: 32px; padding: 0 1px; border: 0; border-radius: 5px; background: transparent; color: #c7c7cc; display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer; }.recent-row:hover { padding: 0 7px; background: #29292c; }.recent-row span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-body); }.recent-row time { flex: 0 0 auto; color: #77777e; font-size: var(--text-small); }
  .message.user { display: flex; justify-content: flex-end; margin: 7px 0 16px; }.message.user > div { max-width: 82%; padding: 12px 15px; border: 0; border-radius: 17px; background: #2d2d30; color: #eeeeef; box-shadow: inset 0 0 0 1px #ffffff08; font-size: var(--text-body); line-height: var(--leading-body); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }.message.assistant { display: block; min-width: 0; margin: 4px 0 12px; }.assistant-body { position: relative; min-width: 0; padding: 1px 29px 0 2px; user-select: text; }.copy-message { position: absolute; top: 0; right: 0; width: 27px; height: 27px; border: 0; border-radius: 5px; background: transparent; color: #777780; display: grid; place-items: center; cursor: pointer; opacity: 0; }.assistant:hover .copy-message,.copy-message:focus { opacity: 1; }.copy-message:hover { background: #313136; color: #ddd; }.turn-meta { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 9px; color: #7d7d87; font-size: var(--text-small); opacity: 0; transition: opacity 150ms ease; }.assistant:hover .turn-meta,.turn-meta:focus-within { opacity: 1; }.turn-meta button { height: 25px; padding: 0 7px; border: 0; border-radius: 4px; background: transparent; color: #85858e; display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: var(--text-small); }.turn-meta button:hover { background: #303035; color: #ddd; }
  .reasoning,.plan { border: 0; border-radius: 6px; background: transparent; }.reasoning summary,.plan summary { min-height: 29px; padding: 0 4px; display: flex; align-items: center; gap: 7px; list-style: none; color: #81818a; cursor: pointer; }.reasoning summary span,.plan summary span { flex: 1; font-size: var(--text-caption); }.reasoning p,.plan > div { margin: 0; padding: 4px 8px 8px 23px; color: #7d7d86; font-size: var(--text-caption); line-height: var(--leading-body); white-space: pre-wrap; }.plan { border: 1px solid #3c3c42; background: #28282c; }.plan > div { border-top: 1px solid #38383e; color: #aaa; }.plan-actions { margin-top: 8px; display: flex; gap: 5px; }.plan-actions button { height: 26px; padding: 0 7px; border: 1px solid #484850; border-radius: 5px; background: #343439; color: #ddd; cursor: pointer; font-size: var(--text-micro); }.working { height: 28px; color: #888891; display: flex; align-items: center; gap: 7px; font-size: var(--text-small); }
  .turn-error { position: relative; padding: 10px 11px; border: 1px solid #633b3b; border-radius: 7px; background: #352525; }.turn-error > button:first-child { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border: 0; background: transparent; color: #b99090; }.turn-error strong { color: #f2c2c2; font-size: var(--text-small); }.turn-error p { margin: 4px 24px 8px 0; color: #b99090; font-size: var(--text-caption); }.turn-error .retry { height: 26px; border: 1px solid #714848; border-radius: 5px; background: #452e2e; color: #f1d0d0; display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: var(--text-caption); }
  .composer-wrap { position: relative; z-index: 50; flex: 0 0 auto; padding: 10px 12px 7px; border-top: 0; background: #222224; box-shadow: 0 -14px 28px #222224; overflow: visible; }.composer { position: relative; overflow: visible; border: 1px solid #3d3d42; border-radius: 17px; background: #1d1d1f; box-shadow: inset 0 1px #ffffff07, 0 8px 24px #0003; transition: border-color 120ms ease, box-shadow 120ms ease; }.composer:focus-within { border-color: #595960; box-shadow: inset 0 1px #ffffff0a, 0 8px 24px #0003, 0 0 0 1px #ffffff05; }.composer.disabled { opacity: .65; }.composer textarea { width: 100%; box-sizing: border-box; min-height: 78px; max-height: 180px; resize: none; border: 0; outline: 0; padding: 15px 14px 8px; background: transparent; color: #f1f1f3; font: var(--text-emphasis)/var(--leading-body) var(--font-ui); field-sizing: content; }.composer textarea::placeholder { color: #72727a; }.composer-controls { height: 42px; display: flex; align-items: center; padding: 0 8px 6px; gap: 2px; }.control-spacer { flex: 1; }.composer-controls > button { width: 30px; height: 30px; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }.attach,.stash,.stop { background: transparent; color: #909098; }.attach:hover,.stash:hover,.stop:hover { background: #2d2d31; color: #ededf0; }.send { background: #e7e7e9; color: #252528; box-shadow: 0 1px 2px #0005; }.send:not(:disabled):hover { background: #fff; }.composer-controls button:disabled { opacity: .35; cursor: default; }.send:disabled { opacity: 1; background: #3a3a3f; color: #777780; box-shadow: none; }.footer-meta { height: 21px; padding: 0 4px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #707078; font-size: var(--text-caption); }.footer-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.footer-meta kbd { flex: 0 0 auto; font: inherit; }
  .attachment-strip { display: flex; gap: 6px; padding: 8px 8px 0; overflow-x: auto; }.attachment-strip > div { width: 58px; height: 48px; position: relative; flex: 0 0 auto; overflow: hidden; border: 1px solid #45454c; border-radius: 6px; background: #252529; display: grid; place-items: center; }.attachment-strip img { width: 100%; height: 100%; object-fit: cover; }.attachment-strip span { position: absolute; inset: auto 2px 2px; overflow: hidden; padding: 2px; background: #171719c9; color: white; font-size: var(--text-micro); text-overflow: ellipsis; white-space: nowrap; }.attachment-strip button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: 0; border-radius: 4px; background: #18181bd9; color: white; display: grid; place-items: center; }
  .command-menu { position: absolute; z-index: 25; left: 7px; right: 7px; bottom: 100px; max-height: 220px; overflow-y: auto; padding: 5px; border: 1px solid #46464d; border-radius: 7px; background: #29292d; box-shadow: 0 12px 35px #000a; }.command-menu button { width: 100%; min-height: 42px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #eee; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; cursor: pointer; }.command-menu button.skill-row { min-height: 32px; justify-content: center; }.command-menu button:hover,.command-menu button.highlighted { background: #3a3a40; }.command-menu strong { font-size: var(--text-control); }.command-menu span { color: #83838c; font-size: var(--text-small); }
  .pending-card { margin-bottom: 8px; overflow: hidden; border: 1px solid #665331; border-radius: 8px; background: #302b22; }.pending-card header { min-height: 40px; padding: 0 8px 0 11px; display: flex; align-items: center; gap: 8px; }.pending-card header strong { flex: 1; font-size: var(--text-body); }.pending-card header span { color: #a99d86; font-size: var(--text-small); }.pending-card > p { margin: 0; padding: 0 11px 9px; color: #aea28e; font-size: var(--text-control); line-height: var(--leading-ui); }.pending-card > p.collapsed-question { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.collapse-pending { width: 26px; height: 26px; border: 0; border-radius: 4px; background: transparent; color: #a99d86; display: grid; place-items: center; }.collapse-pending :global(.rotated) { transform: rotate(180deg); }.pending-card pre { max-height: 140px; margin: 0; padding: 9px 11px; overflow: auto; border-top: 1px solid #51452f; background: #252118; color: #ddd2bb; font: var(--text-small)/var(--leading-body) var(--font-code); white-space: pre-wrap; }.pending-actions { padding: 8px; border-top: 1px solid #51452f; display: flex; justify-content: flex-end; gap: 5px; }.pending-actions button { min-height: 29px; padding: 0 9px; border: 1px solid #5a513e; border-radius: 5px; background: #3b3529; color: #d4cbb8; cursor: pointer; font-size: var(--text-small); }.pending-actions .approve { border-color: #9b6c27; background: #a96c1d; color: white; }.pending-actions .decline { color: #f1b6a9; }.answer-options { padding: 0 8px 8px; display: grid; gap: 4px; }.answer-options button { min-height: 42px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #e2dac9; display: flex; align-items: center; text-align: left; cursor: pointer; }.answer-options button:hover,.answer-options button.selected { background: #423927; }.answer-options button span { flex: 1; display: flex; flex-direction: column; gap: 2px; }.answer-options strong { font-size: var(--text-control); }.answer-options small { color: #998e7b; font-size: var(--text-small); }.answer-options kbd { color: #8f846f; font-family: var(--font-ui); font-size: var(--text-small); }.custom-answer { width: calc(100% - 18px); box-sizing: border-box; height: 33px; margin: 0 9px 9px; border: 1px solid #5b513d; border-radius: 5px; outline: 0; padding: 0 9px; background: #28241d; color: white; font-size: var(--text-control); }
  .banner,.sync-pill { min-height: 29px; margin-bottom: 6px; padding: 5px 7px; display: flex; align-items: center; gap: 6px; border: 1px solid #5e4930; border-radius: 6px; background: #332b20; color: #cbbd9f; font-size: var(--text-caption); }.banner.error { border-color: #633d3d; background: #372727; color: #d6aaaa; }.banner.success { border-color: #365945; background: #26372d; color: #a8d8b9; }.banner span { flex: 1; line-height: var(--leading-ui); }.banner button { width: 22px; height: 22px; border: 0; background: transparent; color: inherit; }.sync-pill { border-color: #414147; background: #2d2d31; color: #9999a2; }
  .history-panel { position: absolute; z-index: 35; inset: 50px 0 0; display: flex; flex-direction: column; background: #242426; }.history-title { height: 46px; padding: 0 13px; display: flex; align-items: center; justify-content: space-between; }.history-title strong { font-size: var(--text-emphasis); }.history-title button { height: 29px; padding: 0 9px; border: 1px solid #46464d; border-radius: 5px; background: #303034; color: #ddd; display: flex; align-items: center; gap: 5px; font-size: var(--text-small); }.history-search { height: 34px; margin: 0 10px 9px; padding: 0 10px; display: flex; align-items: center; gap: 7px; border: 1px solid #434349; border-radius: 6px; background: #2d2d31; color: #777780; }.history-search input { width: 100%; border: 0; outline: 0; background: transparent; color: white; font-size: var(--text-control); }.history-list { min-height: 0; flex: 1; overflow-y: auto; padding: 2px 7px 14px; }.history-row { position: relative; min-height: 53px; padding: 8px; border-radius: 6px; color: #dddde1; display: flex; align-items: center; gap: 8px; cursor: pointer; }.history-row:hover,.history-row.current { background: #333338; }.history-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }.history-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-control); }.history-copy small { color: #797982; font-size: var(--text-caption); }.status { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #55555d; }.status.working { background: #60a5fa; }.status.approval { background: #f59e0b; }.status.input { background: #a78bfa; }.status.failed { background: #f87171; }.unread { width: 6px; height: 6px; border-radius: 50%; background: #f4f4f5; }.row-menu { width: 27px; height: 27px; border: 0; border-radius: 4px; background: transparent; color: #8a8a93; opacity: 0; }.history-row:hover .row-menu { opacity: 1; }.thread-menu { position: absolute; z-index: 5; top: 42px; right: 4px; width: 132px; padding: 5px; border: 1px solid #46464d; border-radius: 6px; background: #29292d; box-shadow: 0 10px 28px #000b; }.thread-menu button { display: flex; align-items: center; gap: 6px; }.history-empty { padding: 30px 15px; text-align: center; color: #74747c; font-size: var(--text-control); }.jump-latest { position: absolute; z-index: 3; right: 17px; bottom: 147px; height: 29px; padding: 0 9px; border: 1px solid #4d4d54; border-radius: 15px; background: #343439; color: #ccc; display: flex; align-items: center; gap: 4px; box-shadow: 0 5px 15px #0006; cursor: pointer; font-size: var(--text-small); }
  .history-panel { inset: 42px 0 0; }
  :global(.spin) { transform-box: fill-box; transform-origin: center; will-change: transform; animation: codex-spin 750ms linear infinite; } @keyframes codex-spin { to { transform: rotate(360deg); } } @keyframes codex-pulse { 50% { opacity: .35; } } @media (prefers-reduced-motion: reduce) { :global(.spin) { animation: codex-pulse 1.1s ease-in-out infinite; } }
</style>
