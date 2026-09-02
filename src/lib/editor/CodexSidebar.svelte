<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import {
    Archive, Robot as Bot, Check, CaretDown as ChevronDown, WarningCircle as CircleAlert,
    Clock as Clock3, Copy, FileImage,
    ClockCounterClockwise as History, CircleNotch as LoaderCircle, SignIn as LogIn,
    ChatText as MessageSquareText, DotsThree as MoreHorizontal, PushPin as Pin,
    PushPinSlash as PinOff, Plus, ArrowClockwise as RotateCcw,
    MagnifyingGlass as Search, ArrowUp as Send, Square, Trash as Trash2,
    ArrowCounterClockwise as Undo2, Wrench, X,
  } from "phosphor-svelte";
  import MarkdownText from "$lib/editor/MarkdownText.svelte";
  import CodexModelPicker from "$lib/editor/CodexModelPicker.svelte";
  import CodexTraitsPicker from "$lib/editor/CodexTraitsPicker.svelte";
  import CodexContextMeter from "$lib/editor/CodexContextMeter.svelte";
  import CodexToolGroup from "$lib/editor/CodexToolGroup.svelte";
  import EvolveProgress from "$lib/editor/EvolveProgress.svelte";
  import { describeApprovalRequest } from "$lib/editor/codex-approval";
  import {
    buildDisplayTimelineRows, emptyTimeline, formatTokenCount,
    inputSkills, inputText, itemText, object, reduceCodexEvent,
    resolveCodexSelection, threadAttention, threadTitle, uniqueEnabledSkills,
    timelineFromThread, type CodexEvent, type CodexItem, type CodexModel,
    type CodexSelection, type CodexThread, type CodexTimeline, type CodexTurnMeta,
    type JsonObject,
  } from "$lib/codex-protocol";
  import {
    COMPOSER_COMMANDS, CONTEXT_MENTIONS, composerTrigger, draftKey,
    emptyCodexUiState, evolveDirection, parseCodexUiState, replaceComposerTrigger,
    type CodexApprovalMode, type CodexAttachment, type CodexUiState,
    type ComposerCommand,
  } from "$lib/codex-ui-state";

  type Attention = "idle" | "working" | "approval" | "input" | "complete" | "error";
  type ConnectionState = "connecting" | "ready" | "error";
  type PendingRequest = { id: string | number; method: string; params: JsonObject };
  type Connection = { workspaceId: string; cwd: string; reused: boolean };
  type Skill = { name: string; path: string; description?: string; shortDescription?: string; enabled?: boolean };
  type NativeClipboardContent = { kind: "image"; dataUrl?: string; data_url?: string; name: string } | { kind: "text"; text: string } | { kind: "empty" };
  type EvolveStage = "idle" | "capture" | "review" | "design" | "preview" | "compare" | "verify" | "commit";
  type EvolveCriterion = { id: string; requirement: string; status: "met" | "partial" | "unmet"; evidence: string };
  type EvolveRegion = { criterionId: string; x: number; y: number; width: number; height: number; priority: number; note: string; desiredOutcome: string };
  type EvolveObjective = {
    criterionIds: string[];
    instruction: string;
    completionSignal: string;
    preserve: string[];
  };
  type EvolveAssessment = {
    verdict: "revise" | "satisfied";
    preference: "image_1" | "image_2" | "tie" | "not_applicable";
    confidence: number;
    criteria: EvolveCriterion[];
    regions: EvolveRegion[];
    successes: Array<{ criterionId: string; note: string }>;
    regressions: Array<{ severity: "minor" | "major" | "blocking"; note: string }>;
    summary: string;
    nextObjective: EvolveObjective | null;
  };
  type EvolveJournalCandidate = {
    id: string;
    title: string;
    hypothesis: string;
    mechanism: string;
    tradeoff: string;
    outcome: "accepted" | "rejected" | "duplicate" | "failed" | "superseded" | "pending";
    reason: string;
  };
  type EvolveJournalGeneration = { generation: number; objective: EvolveObjective; candidate: EvolveJournalCandidate };
  type EvolveRunOutcome = "running" | "complete" | "stopped" | "error" | null;
  type EvolveProposal = {
    operations: JsonObject[];
    summary: string;
    rawText: string;
    baseInput: JsonObject[];
    candidateId: string;
    title: string;
    hypothesis: string;
    mechanism: string;
    intendedTradeoff: string;
  };
  type EvolveRenderedCandidate = {
    proposal: EvolveProposal;
    image: string;
    thumbnail: string;
    context: JsonObject;
    comparison?: EvolveAssessment;
  };
  type EvolveActivity = { id: string; pass: number; title: string; detail: string; notes: string[]; image?: string; status: "working" | "complete" | "kept" | "discarded" | "recovering" };
  type EvolveExecResponse = { execId: string; text: string; exitCode: number };
  type PromptSegment = { type: "text" | "skill"; value: string; name?: string };
  let { workspaceId, pageId, fileName, visible, embedded = false, onAttentionChange, onClose, onEditorRpc }: {
    workspaceId: string;
    pageId: string;
    fileName: string;
    visible: boolean;
    embedded?: boolean;
    onAttentionChange: (attention: Attention) => void;
    onClose: () => void;
    onEditorRpc?: (method: string, params: JsonObject) => Promise<unknown>;
  } = $props();

  let connection = $state<ConnectionState>("connecting");
  let connectionError = $state("");
  let providerWarning = $state("");
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
  let selectedSkills = $state<Skill[]>([]);
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
  let evolveRunning = $state(false);
  let evolveStage = $state<EvolveStage>("idle");
  let evolvePass = $state(0);
  let evolveKept = $state(0);
  let evolveDiscarded = $state(0);
  let evolveActivities = $state<EvolveActivity[]>([]);
  let evolveRunOutcome = $state<EvolveRunOutcome>(null);
  let evolveJournal = $state<EvolveJournalGeneration[]>([]);
  let evolveJournalPersisted = false;
  let evolveParentThreadId = "";
  let evolveRunId = "";
  let evolveWorkflowEpoch = 0;
  let evolveCancelled = false;
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
  let nativePasteBusy = false;
  let composerCursor = $state(0);
  let composerScrollTop = $state(0);
  let scroller: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let attachmentInput: HTMLInputElement;
  let removeListeners: (() => void)[] = [];
  const evolveExecActivities = new Map<string, string>();

  const working = $derived(Boolean(timeline.activeTurnId));
  const activeModel = $derived(models.find((model) => model.model === selection.model));
  const supportsImages = $derived(activeModel?.inputModalities?.includes("image") ?? true);
  const approvalMode = $derived(uiState.approvalMode);
  const currentThread = $derived(threads.find((thread) => thread.id === currentThreadId));
  const currentPending = $derived(pendingRequests.filter((request) => request.params.threadId === currentThreadId || (!request.params.threadId && currentThreadId)));
  const activePending = $derived(currentPending[0]);
  const activeApproval = $derived(activePending ? describeApprovalRequest(activePending) : null);
  const activeQuestions = $derived(activePending?.method === "item/tool/requestUserInput" && Array.isArray(activePending.params.questions) ? activePending.params.questions.map(object) : []);
  const activeQuestion = $derived(activeQuestions[questionIndex]);
  const blockedByRequest = $derived(Boolean(activePending));
  const filteredThreads = $derived.by(() => threads
    .filter((thread) => threadTitle(thread).toLowerCase().includes(historySearch.trim().toLowerCase()))
    .toSorted((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || (b.recencyAt ?? b.updatedAt) - (a.recencyAt ?? a.updatedAt)));
  const recentThreads = $derived(threads.slice(0, 3));
  const evolveStageLabel = $derived({
    capture: "Capturing the selected frame",
    review: "Director is reviewing the direction",
    design: `Building reconstruction pass ${Math.max(1, evolvePass)}`,
    preview: "Rendering isolated candidate canvases",
    compare: "Selecting the strongest challenger",
    verify: "Verifying that the direction is satisfied",
    commit: "Finishing the reconstruction",
    idle: "Preparing evolution",
  }[evolveStage]);
  const evolveCardLabel = $derived(evolveRunOutcome === "complete" ? "Evolution complete" : evolveRunOutcome === "stopped" ? "Evolution stopped" : evolveRunOutcome === "error" ? "Evolution ended with an error" : evolveStageLabel);

  function compactEvolveActivities(items: EvolveActivity[]): EvolveActivity[] {
    const trimmed = items.slice(-60);
    const imageCutoff = Math.max(0, trimmed.length - 8);
    return trimmed.map((activity, index) => index < imageCutoff && activity.image ? { ...activity, image: undefined } : activity);
  }

  function beginEvolveActivity(title: string, detail = ""): string {
    const id = crypto.randomUUID();
    evolveActivities = compactEvolveActivities([...evolveActivities, { id, pass: evolvePass, title, detail, notes: [], status: "working" }]);
    return id;
  }

  function finishEvolveActivity(id: string, status: EvolveActivity["status"], detail = "", notes: string[] = []) {
    evolveActivities = compactEvolveActivities(evolveActivities.map((activity) => activity.id === id ? { ...activity, status, detail: detail || activity.detail, notes } : activity));
  }

  function updateEvolveActivity(id: string, patch: Partial<Omit<EvolveActivity, "id" | "pass">>) {
    evolveActivities = compactEvolveActivities(evolveActivities.map((activity) => activity.id === id ? { ...activity, ...patch } : activity));
  }
  const trigger = $derived(composerTrigger(prompt, composerCursor));
  const promptSegments = $derived.by(() => {
    const result: PromptSegment[] = [];
    const available = new Set([...skills, ...selectedSkills].map((skill) => skill.name));
    const pattern = /`[^`\n]*`|\$([A-Za-z0-9][A-Za-z0-9_-]*)/g;
    let cursor = 0;
    for (const match of prompt.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > cursor) result.push({ type: "text", value: prompt.slice(cursor, start) });
      const name = match[1];
      if (name && available.has(name)) result.push({ type: "skill", value: match[0], name });
      else result.push({ type: "text", value: match[0] });
      cursor = start + match[0].length;
    }
    if (cursor < prompt.length) result.push({ type: "text", value: prompt.slice(cursor) });
    return result;
  });
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
    if (evolveRunning) return "Wait for the director and designer, or stop this evolution";
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

  async function requestAllThreadItems(threadId: string): Promise<CodexItem[]> {
    const result: CodexItem[] = [];
    let cursor: string | null = null;
    do {
      const response: { data?: unknown[]; nextCursor?: string | null } = await request("thread/items/list", { threadId, limit: 100, sortDirection: "asc", ...(cursor ? { cursor } : {}) });
      for (const entryValue of response.data ?? []) {
        const entry = object(entryValue);
        const item = object(entry.item);
        if (typeof item.id !== "string" || typeof item.type !== "string") continue;
        result.push({ ...item, id: item.id, type: item.type, _turnId: typeof entry.turnId === "string" ? entry.turnId : undefined });
      }
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
      listen<{ execId?: string; runId?: string; event?: unknown }>("codex-evolve-event", ({ payload }) => handleEvolveExecEvent(payload)),
      listen("codex-disconnected", () => {
        if (!disposed) {
          if (evolveRunning) void cancelEvolveWorkflow();
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
      if (evolveRunning) void cancelEvolveWorkflow();
      void persistUiState(true);
      void invoke("codex_disconnect").catch(() => undefined);
    };
  });

  $effect(() => {
    const lastItem = timeline.items.at(-1);
    const lastActivity = evolveActivities.at(-1);
    const marker = `${timeline.items.length}:${lastItem?.id ?? ""}:${lastItem ? itemText(lastItem).length + String(lastItem.aggregatedOutput ?? "").length : 0}:${evolveActivities.length}:${lastActivity?.id ?? ""}:${lastActivity?.status ?? ""}:${lastActivity?.detail.length ?? 0}:${lastActivity?.notes.join("\n").length ?? 0}`;
    if (!marker || !pinnedToBottom) return;
    void tick().then(() => scrollToLatest(false));
  });

  $effect(() => {
    trigger?.query;
    suggestionIndex = 0;
  });

  $effect(() => {
    if (!uiStateLoaded) return;
    prompt; attachments; selectedSkills.map((skill) => `${skill.name}:${skill.path}`).join("|"); selection.model; selection.effort; selection.serviceTier; selectionExplicit; uiState.approvalMode; uiState.promptStash.join("|"); uiState.pinnedThreadIds.join("|"); currentThreadId;
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => void persistUiState(), 180);
  });

  $effect(() => {
    onAttentionChange(attention);
  });

  $effect(() => {
    if (!visible) { lastMarkedVisitedThread = ""; return; }
    if (!working && !evolveRunning && !activePending && attention !== "error" && attention !== "idle") setAttention("idle");
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
      const [accountResponse, loadedModels, loadedThreads, skillResponse] = await Promise.all([
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
      ]);
      account = accountResponse.account;
      models = loadedModels;
      uiState = { ...uiState, cachedModels: loadedModels };
      threads = loadedThreads.map((thread) => ({ ...thread, isPinned: thread.isPinned || uiState.pinnedThreadIds.includes(thread.id) }));
      skills = uniqueEnabledSkills(skillResponse.data?.flatMap((entry) => entry.skills ?? []) ?? []);
      loadDraft(null);
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

  function handleEvolveExecEvent(payload: { execId?: string; runId?: string; event?: unknown }) {
    if (!evolveRunning || payload.runId !== evolveRunId || !payload.execId) return;
    const activityId = evolveExecActivities.get(payload.execId);
    if (!activityId) return;
    const event = object(payload.event);
    if (event.type !== "item.started" && event.type !== "item.completed") return;
    const item = object(event.item);
    const itemType = String(item.type ?? "");
    let detail = "";
    if (itemType === "mcp_tool_call") {
      const tool = String(item.tool ?? item.name ?? "");
      detail = tool.includes("types_get") ? "A designer is reading the native layer contract" : tool.includes("evolve_candidate_validate") ? "A designer is validating its candidate" : "A designer is checking its work";
    } else if (itemType === "agent_message") detail = "Collecting the construction proposal";
    else if (itemType.includes("collab") || itemType.includes("agent")) detail = "Designers are working independently";
    if (detail) updateEvolveActivity(activityId, { detail });
  }

  function handleEvent(event: CodexEvent) {
    const params = object(event.params);
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
      if (object(params.thread).ephemeral !== true && !threads.some((thread) => thread.id === started.id)) threads = [started, ...threads];
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
        [key]: { prompt, selection, selectionExplicit, attachments: attachments.map(({ previewUrl: _, ...item }) => item), skills: skillsForPrompt(prompt).map(({ name, path }) => ({ name, path })) },
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
    const restoredSkills = draft?.skills?.map((saved) => skills.find((skill) => skill.name === saved.name) ?? saved) ?? [];
    const restoredPrompt = draft?.prompt ?? "";
    const missingTokens = restoredSkills.filter((skill) => !skillPattern(skill.name).test(restoredPrompt)).map((skill) => `$${skill.name}`);
    prompt = missingTokens.length ? `${missingTokens.join(" ")}${restoredPrompt ? ` ${restoredPrompt}` : ""}` : restoredPrompt;
    attachments = draft?.attachments ?? [];
    selectedSkills = restoredSkills;
    composerCursor = prompt.length;
    selectionExplicit = draft?.selectionExplicit === true;
    selection = resolveCodexSelection(models, selectionExplicit ? draft?.selection : fallback ?? draft?.selection);
  }

  async function openThread(id: string) {
    if (id === currentThreadId && timeline.items.length) { historyOpen = false; return; }
    saveCurrentDraftLocally();
    if (!evolveRunning) { evolveActivities = []; evolveRunOutcome = null; evolveJournal = []; evolveParentThreadId = ""; }
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
      if (!timeline.items.length) {
        const injectedItems = await requestAllThreadItems(id).catch(() => []);
        if (injectedItems.length) timeline = { ...timeline, items: injectedItems };
      }
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
    evolveActivities = [];
    evolveRunOutcome = null;
    evolveJournal = [];
    evolveParentThreadId = "";
    historyOpen = false;
    historyMenu = null;
    dismissedTurnError = "";
    loadDraft(null, selection);
    void tick().then(() => composer?.focus());
  }

  function approvalParams<T extends JsonObject>(params: T): T & JsonObject {
    return { ...params, approvalPolicy: "on-request", approvalsReviewer: approvalMode === "auto" ? "auto_review" : "user", sandbox: "workspace-write" };
  }

  function figmaboyDeveloperInstructions(): string {
    return `You are embedded in Figmaboy with the design file "${fileName}" open. Use the figmaboy MCP server to inspect and edit the open design. Resolve @selection, @current-frame, @page, and @design by inspecting the live editor. Read current state before changing it, make native editable layers, and visually inspect the result before finishing. When the user asks for a reusable tool or extension, read design_capabilities.extensions and call extension_stage with a declarative manifest. You may stage a trial, but only the user may run, Keep, or Discard it. Keep chat updates concise and describe completed design changes in plain language.`;
  }

  function screenshotDataUrl(response: JsonObject): string {
    if (typeof response.imageBase64 === "string") return `data:${typeof response.mimeType === "string" ? response.mimeType : "image/png"};base64,${response.imageBase64}`;
    if (!Array.isArray(response.content)) throw new Error("Figmaboy did not return a frame image");
    const image = response.content.map((part) => object(part)).find((part) => part.type === "image" && typeof part.data === "string");
    if (!image) throw new Error("Figmaboy did not return a frame image");
    return `data:${typeof image.mimeType === "string" ? image.mimeType : "image/png"};base64,${image.data}`;
  }

  function thumbnailDataUrl(response: JsonObject): string {
    if (typeof response.thumbnailBase64 === "string") return `data:${typeof response.thumbnailMimeType === "string" ? response.thumbnailMimeType : "image/jpeg"};base64,${response.thumbnailBase64}`;
    return screenshotDataUrl(response);
  }

  async function captureEvolveFrame(frameId: string): Promise<string> {
    return screenshotDataUrl(await callEditor("frame_screenshot", {
      frameId,
      scale: 1,
      maxDimension: 1600,
      format: "jpeg",
      quality: .86,
    }));
  }

  async function callEditor(tool: string, args: JsonObject = {}): Promise<JsonObject> {
    if (!onEditorRpc) throw new Error("Evolution editor bridge is unavailable");
    return object(await onEditorRpc(tool, args));
  }

  function frameContext(documentValue: unknown, frameId: string): JsonObject {
    const document = object(documentValue);
    const nodes = object(document.nodes);
    const selected: JsonObject = {};
    const visit = (id: string) => {
      if (selected[id]) return;
      const node = object(nodes[id]);
      if (!Object.keys(node).length) return;
      selected[id] = node;
      if (Array.isArray(node.childIds)) node.childIds.filter((child): child is string => typeof child === "string").forEach(visit);
    };
    visit(frameId);
    return { frameId, nodes: selected };
  }

  function evolveEffort(): string {
    const supported = activeModel?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [];
    if (supported.includes(selection.effort)) return selection.effort;
    return activeModel?.defaultReasoningEffort ?? selection.effort;
  }

  function evolveFastTier(): string {
    const catalogTier = activeModel?.serviceTiers?.find((tier) => tier.name.toLowerCase() === "fast" || tier.id === "fast" || tier.id === "priority")?.id;
    return catalogTier ?? activeModel?.additionalSpeedTiers?.find((tier) => tier === "fast" || tier === "priority") ?? "default";
  }

  function parseAgentJson(text: string): JsonObject {
    const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const value = JSON.parse(clean);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Specialist returned invalid JSON");
    return value as JsonObject;
  }

  function designerSchema(): JsonObject {
    return {
      type: "object", additionalProperties: false,
      required: ["updates", "creates", "reorders", "deletes", "reparents", "summary", "title", "hypothesis", "mechanism", "intendedTradeoff"],
      properties: {
        title: { type: "string" },
        hypothesis: { type: "string" },
        mechanism: { type: "string" },
        intendedTradeoff: { type: "string" },
        updates: { type: "array", minItems: 0, maxItems: 100, items: {
          type: "object", additionalProperties: false, required: ["id", "patchJson"], properties: { id: { type: "string" }, patchJson: { type: "string" } },
        } },
        creates: { type: "array", minItems: 0, maxItems: 100, items: {
          type: "object", additionalProperties: false, required: ["parentId", "nodeJson", "index"], properties: { parentId: { type: "string" }, nodeJson: { type: "string" }, index: { type: "integer", minimum: -1 } },
        } },
        reorders: { type: "array", minItems: 0, maxItems: 30, items: {
          type: "object", additionalProperties: false, required: ["parentId", "ids"], properties: { parentId: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
        } },
        deletes: { type: "array", minItems: 0, maxItems: 100, items: {
          type: "object", additionalProperties: false, required: ["ids"], properties: { ids: { type: "array", minItems: 1, items: { type: "string" } } },
        } },
        reparents: { type: "array", minItems: 0, maxItems: 100, items: {
          type: "object", additionalProperties: false, required: ["ids", "parentId", "index"], properties: { ids: { type: "array", minItems: 1, items: { type: "string" } }, parentId: { type: "string" }, index: { type: "integer", minimum: -1 } },
        } },
        summary: { type: "string" },
      },
    };
  }

  async function runEvolveExec(role: "designer" | "director" | "correction", promptText: string, images: Array<{ name: string; dataUrl: string }>, outputSchema: JsonObject, activityId?: string): Promise<string> {
    const execId = crypto.randomUUID();
    if (activityId) evolveExecActivities.set(execId, activityId);
    try {
      const response = await invoke<EvolveExecResponse>("codex_evolve_exec", {
        request: { execId, runId: evolveRunId, workspaceId, role, prompt: promptText, images, outputSchema, model: selection.model, effort: evolveEffort(), serviceTier: evolveFastTier() },
      });
      return response.text;
    } finally {
      evolveExecActivities.delete(execId);
    }
  }

  function cleanNote(value: unknown, label: string): string {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 320) : "";
    if (text.length < 8) throw new Error(`${label} is too vague`);
    return text;
  }

  function cleanStringList(value: unknown, limit: number): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.replace(/\s+/g, " ").trim().slice(0, 180)).filter(Boolean).slice(0, limit) : [];
  }

  function directorSchema(): JsonObject {
    return {
      type: "object", additionalProperties: false,
      required: ["verdict", "preference", "confidence", "criteria", "regions", "successes", "regressions", "summary", "nextObjective"],
      properties: {
        verdict: { type: "string", enum: ["revise", "satisfied"] },
        preference: { type: "string", enum: ["image_1", "image_2", "tie", "not_applicable"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        criteria: { type: "array", minItems: 2, maxItems: 6, items: {
          type: "object", additionalProperties: false, required: ["id", "requirement", "status", "evidence"],
          properties: { id: { type: "string" }, requirement: { type: "string" }, status: { type: "string", enum: ["met", "partial", "unmet"] }, evidence: { type: "string" } },
        } },
        regions: { type: "array", minItems: 0, maxItems: 3, items: {
          type: "object", additionalProperties: false, required: ["criterionId", "x", "y", "width", "height", "priority", "note", "desiredOutcome"],
          properties: { criterionId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, priority: { type: "integer", minimum: 1, maximum: 3 }, note: { type: "string" }, desiredOutcome: { type: "string" } },
        } },
        successes: { type: "array", minItems: 0, maxItems: 8, items: {
          type: "object", additionalProperties: false, required: ["criterionId", "note"], properties: { criterionId: { type: "string" }, note: { type: "string" } },
        } },
        regressions: { type: "array", minItems: 0, maxItems: 6, items: {
          type: "object", additionalProperties: false, required: ["severity", "note"], properties: { severity: { type: "string", enum: ["minor", "major", "blocking"] }, note: { type: "string" } },
        } },
        summary: { type: "string" },
        nextObjective: {
          type: "object", additionalProperties: false, required: ["criterionIds", "instruction", "completionSignal", "preserve"],
          properties: {
            criterionIds: { type: "array", minItems: 0, maxItems: 6, items: { type: "string" } },
            instruction: { type: "string" },
            completionSignal: { type: "string" },
            preserve: { type: "array", minItems: 0, maxItems: 8, items: { type: "string" } },
          },
        },
      },
    };
  }

  function validatedAssessment(value: JsonObject, frame: JsonObject, frozen: EvolveCriterion[] | null): EvolveAssessment {
    if (!Array.isArray(value.criteria) || !Array.isArray(value.regions) || !Array.isArray(value.successes) || !Array.isArray(value.regressions)) throw new Error("Director returned an incomplete assessment");
    const rawCriteria = value.criteria.map((criterionValue) => object(criterionValue));
    if (!frozen && rawCriteria.length < 2) throw new Error("Director did not establish enough direction criteria");
    const criteria = (frozen ?? rawCriteria.map((criterion, index) => ({ id: String(criterion.id || `goal-${index + 1}`), requirement: cleanNote(criterion.requirement, "Direction criterion"), status: "unmet" as const, evidence: "Not assessed yet" }))).map((criterion) => {
      const returned = rawCriteria.find((candidate) => String(candidate.id) === criterion.id) ?? {};
      const status: EvolveCriterion["status"] = returned.status === "met" || returned.status === "partial" || returned.status === "unmet" ? returned.status : "unmet";
      return { ...criterion, status, evidence: cleanNote(returned.evidence, "Direction evidence") };
    });
    const criterionIds = new Set(criteria.map((criterion) => criterion.id));
    const frameWidth = Number(frame.width);
    const frameHeight = Number(frame.height);
    const regions = value.regions.slice(0, 3).map((regionValue) => {
      const region = object(regionValue);
      const criterionId = String(region.criterionId ?? "");
      if (!criterionIds.has(criterionId)) throw new Error("Director linked a region to an unknown direction criterion");
      const numbers = [region.x, region.y, region.width, region.height, region.priority].map(Number);
      if (numbers.some((number) => !Number.isFinite(number)) || numbers[2] <= 0 || numbers[3] <= 0) throw new Error("Director returned invalid coordinates");
      const x = Math.max(0, Math.min(frameWidth, numbers[0]));
      const y = Math.max(0, Math.min(frameHeight, numbers[1]));
      return { criterionId, x, y, width: Math.max(1, Math.min(frameWidth - x, numbers[2])), height: Math.max(1, Math.min(frameHeight - y, numbers[3])), priority: Math.max(1, Math.min(3, Math.round(numbers[4]))), note: cleanNote(region.note, "Director note"), desiredOutcome: cleanNote(region.desiredOutcome, "Desired outcome") };
    });
    const successes = value.successes.map((successValue) => object(successValue)).filter((success) => criterionIds.has(String(success.criterionId))).map((success) => ({ criterionId: String(success.criterionId), note: cleanNote(success.note, "Success note") }));
    const regressions = value.regressions.map((regressionValue) => object(regressionValue)).map((regression) => {
      const severity: EvolveAssessment["regressions"][number]["severity"] = regression.severity === "blocking" || regression.severity === "major" ? regression.severity : "minor";
      return { severity, note: cleanNote(regression.note, "Regression note") };
    });
    const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
    const preference = value.preference === "image_1" || value.preference === "image_2" || value.preference === "tie" ? value.preference : "not_applicable";
    const satisfied = value.verdict === "satisfied" && regions.length === 0 && criteria.every((criterion) => criterion.status === "met") && !regressions.some((regression) => regression.severity !== "minor");
    let nextObjective: EvolveObjective | null = null;
    if (!satisfied) {
      const raw = object(value.nextObjective);
      const selected = cleanStringList(raw.criterionIds, 6).filter((id) => criterionIds.has(id));
      nextObjective = {
        criterionIds: selected.length ? selected : criteria.filter((criterion) => criterion.status !== "met").slice(0, 2).map((criterion) => criterion.id),
        instruction: cleanNote(raw.instruction, "Next construction objective"),
        completionSignal: cleanNote(raw.completionSignal, "Objective completion signal"),
        preserve: cleanStringList(raw.preserve, 8),
      };
    }
    return { verdict: satisfied ? "satisfied" : "revise", preference, confidence, criteria, regions, successes, regressions, summary: cleanNote(value.summary, "Director summary"), nextObjective };
  }

  function designerCandidate(value: JsonObject): { operations: JsonObject[]; summary: string; title: string; hypothesis: string; mechanism: string; intendedTradeoff: string } {
    if (!Array.isArray(value.updates) || !Array.isArray(value.creates) || !Array.isArray(value.reorders) || !Array.isArray(value.deletes) || !Array.isArray(value.reparents)) throw new Error("Designer returned an incomplete change set");
    const operations: JsonObject[] = [];
    const createdIds = new Set<string>();
    for (const [index, createValue] of value.creates.entries()) {
      const create = object(createValue);
      if (typeof create.parentId !== "string" || typeof create.nodeJson !== "string") throw new Error("Designer returned an invalid create operation");
      let node: unknown;
      try { node = JSON.parse(create.nodeJson); }
      catch (cause) { throw new Error(`creates[${index}].nodeJson is not valid JSON: ${errorMessage(cause)}`); }
      const nodeObject = object(node);
      if (typeof nodeObject.id !== "string" || createdIds.has(nodeObject.id)) throw new Error("Every created layer needs a unique stable ID");
      createdIds.add(nodeObject.id);
      operations.push({ kind: "create", parentId: create.parentId, node: nodeObject, ...(Number(create.index) >= 0 ? { index: Number(create.index) } : {}) });
    }
    for (const [index, updateValue] of value.updates.entries()) {
      const update = object(updateValue);
      if (typeof update.id !== "string" || typeof update.patchJson !== "string") throw new Error("Designer returned an invalid layer update");
      let patch: unknown;
      try { patch = JSON.parse(update.patchJson); }
      catch (cause) { throw new Error(`updates[${index}].patchJson is not valid JSON: ${errorMessage(cause)}`); }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Designer returned an invalid layer patch");
      operations.push({ kind: "update", id: update.id, patch: patch as JsonObject });
    }
    for (const reorderValue of value.reorders) {
      const reorder = object(reorderValue);
      if (typeof reorder.parentId !== "string" || !Array.isArray(reorder.ids) || reorder.ids.some((id) => typeof id !== "string")) throw new Error("Designer returned an invalid reorder operation");
      operations.push({ kind: "reorder", parentId: reorder.parentId, ids: reorder.ids });
    }
    for (const deleteValue of value.deletes) {
      const deletion = object(deleteValue);
      if (!Array.isArray(deletion.ids) || deletion.ids.some((id) => typeof id !== "string")) throw new Error("Designer returned an invalid delete operation");
      operations.push({ kind: "delete", ids: deletion.ids });
    }
    for (const reparentValue of value.reparents) {
      const reparent = object(reparentValue);
      if (!Array.isArray(reparent.ids) || reparent.ids.some((id) => typeof id !== "string") || typeof reparent.parentId !== "string") throw new Error("Designer returned an invalid reparent operation");
      operations.push({ kind: "reparent", ids: reparent.ids, parentId: reparent.parentId, ...(Number(reparent.index) >= 0 ? { index: Number(reparent.index) } : {}) });
    }
    if (!operations.length) throw new Error("Designer returned no changes");
    return {
      operations,
      summary: cleanNote(value.summary, "Designer summary"),
      title: cleanNote(value.title, "Pass title").slice(0, 72),
      hypothesis: cleanNote(value.hypothesis, "Pass hypothesis"),
      mechanism: cleanNote(value.mechanism, "Pass mechanism").slice(0, 120),
      intendedTradeoff: cleanNote(value.intendedTradeoff, "Pass tradeoff"),
    };
  }

  function textInput(text: string): JsonObject {
    return { type: "text", text, text_elements: [] };
  }

  function imageInput(url: string): JsonObject {
    return { type: "image", url, detail: "original" };
  }

  function evolveHistoryItem(role: "user" | "assistant", text: string): JsonObject {
    if (role === "user") return { type: "message", role, content: [{ type: "input_text", text }] };
    return {
      id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      type: "message",
      role,
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
  }

  async function injectEvolveHistory(threadId: string, role: "user" | "assistant", text: string) {
    await request("thread/inject_items", { threadId, items: [evolveHistoryItem(role, text)] });
  }

  function retryableEvolveError(cause: unknown): boolean {
    return /network|connection|transport|timeout|timed out|unresponsive|rate.?limit|429|5\d\d|server error|temporarily unavailable/i.test(errorMessage(cause));
  }

  function evolveRecoveryDetail(role: "director" | "designer", cause: unknown): string {
    const message = errorMessage(cause);
    if (/network|connection|transport|5\d\d|server error|temporarily unavailable/i.test(message)) return "Connection lost. Trying again with a fresh agent.";
    if (/rate.?limit|429/i.test(message)) return "Codex is busy. Waiting before another attempt.";
    return `The ${role} stopped responding. Trying again.`;
  }

  function evolveRecoveryNotes(cause: unknown, attempt: number): string[] {
    const message = errorMessage(cause).replace(/\s+/g, " ").trim();
    return [`Attempt ${attempt} ended: ${message.slice(0, 420)}`];
  }

  async function waitForRetry(attempt: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4))));
    if (evolveCancelled) throw new Error("Evolution stopped");
  }

  async function runDirector(args: {
    direction: string;
    frame: JsonObject;
    sourceContext: JsonObject;
    draftContext: JsonObject;
    referenceImage: string;
    currentImage: string;
    frozen: EvolveCriterion[] | null;
    candidateImage?: string;
    objective?: EvolveObjective;
    verification?: boolean;
  }): Promise<EvolveAssessment> {
    const comparing = Boolean(args.candidateImage && args.objective);
    const title = comparing ? `Judging construction pass ${evolvePass}` : args.verification ? "Checking the reconstruction one more time" : "Planning the next construction pass";
    const criteria = args.frozen
      ? `Frozen direction criteria: ${JSON.stringify(args.frozen.map(({ id, requirement }) => ({ id, requirement })))}`
      : "Create 2 to 6 stable criteria from the user's direction. Include preservation of required source content as a criterion.";
    const images = [
      { name: "reference", dataUrl: args.referenceImage },
      { name: "current-draft", dataUrl: args.currentImage },
      ...(args.candidateImage ? [{ name: "candidate", dataUrl: args.candidateImage }] : []),
    ];
    const comparison = comparing
      ? `The second attached image is the current reconstruction. The third is the proposed next pass. In the preference field, image_1 means keep the current reconstruction and image_2 means accept the candidate. Choose image_2 only when the candidate materially advances this pass objective without breaking completed work. A partial reconstruction does not need to match the finished reference yet. Pass objective: ${JSON.stringify(args.objective)}`
      : "Review the current reconstruction against the frozen criteria. Set preference to not_applicable. If work remains, choose the smallest coherent visible nextObjective. It must cover one region, component, or design decision and include an observable completionSignal. Do not ask for a complete screen, several sections, or broad polish in one pass. The first objective for an empty draft should establish only the outer shell or one primary structural region.";
    const promptText = `Act as the construction director for a first-principles redesign. Treat the reconstruction like a painting built layer by layer. Choose what this pass should add, let that layer stand on its own, inspect it, then leave the next layer for the next pass. The reference frame is frozen and must not be edited. It supplies exact content, assets, dimensions, and product intent. The reconstruction may use a different composition and visual system to satisfy the user's direction. Do not reward pixel imitation. Do not reject an early pass merely because later detail is unfinished. Judge progress at the scale of the stated objective. verdict=satisfied is valid only when every frozen criterion is visibly met and no material work remains. Return only the required structured result.

Attached images are REFERENCE, CURRENT DRAFT${args.candidateImage ? ", and CANDIDATE" : ""}, in that order.
User direction: ${args.direction}
${criteria}
${comparison}
${args.verification ? "This is an independent finish check. Reopen construction if any material criterion remains partial." : ""}
Frozen reference layers: ${JSON.stringify(args.sourceContext)}
Current reconstruction layers: ${JSON.stringify(args.draftContext)}`;
    const activityId = beginEvolveActivity(title);
    for (let attempt = 0; attempt < 2 && !evolveCancelled; attempt += 1) {
      if (attempt) updateEvolveActivity(activityId, { status: "working", detail: "Trying again with a fresh director" });
      try {
        const text = await runEvolveExec("director", promptText, images, directorSchema(), activityId);
        const assessment = validatedAssessment(parseAgentJson(text), args.frame, args.frozen);
        const notes = [
          ...assessment.regions.map((region) => `${region.note} → ${region.desiredOutcome}`),
          ...(assessment.nextObjective ? [`Next: ${assessment.nextObjective.instruction}`, `Done when: ${assessment.nextObjective.completionSignal}`] : []),
        ];
        finishEvolveActivity(activityId, "complete", assessment.summary, notes);
        return assessment;
      } catch (cause) {
        if (!retryableEvolveError(cause) || evolveCancelled || attempt >= 1) {
          finishEvolveActivity(activityId, "discarded", errorMessage(cause));
          throw cause;
        }
        finishEvolveActivity(activityId, "recovering", evolveRecoveryDetail("director", cause), evolveRecoveryNotes(cause, attempt + 1));
        await waitForRetry(attempt + 1);
      }
    }
    throw new Error("Evolution stopped");
  }

  function designerBrief(args: {
    direction: string;
    sourceFrameId: string;
    draftFrameId: string;
    sourceContext: JsonObject;
    draftContext: JsonObject;
    assessment: EvolveAssessment;
    objective: EvolveObjective;
    candidateId: string;
  }): string {
    return `Candidate ID: ${args.candidateId}
User direction: ${args.direction}
Frozen reference frame ID: ${args.sourceFrameId}
Writable reconstruction frame ID: ${args.draftFrameId}
Pass objective: ${JSON.stringify(args.objective)}
Direction criteria: ${JSON.stringify(args.assessment.criteria.map(({ id, requirement, status }) => ({ id, requirement, status })))}
Visible opportunities: ${JSON.stringify(args.assessment.regions)}
Completed work to preserve: ${JSON.stringify(args.assessment.successes)}
Frozen reference layers and exact content: ${JSON.stringify(args.sourceContext)}
Current reconstruction layers: ${JSON.stringify(args.draftContext)}`;
  }

  async function runDesigner(args: {
    direction: string;
    sourceFrameId: string;
    draftFrameId: string;
    sourceContext: JsonObject;
    draftContext: JsonObject;
    referenceImage: string;
    currentImage: string;
    assessment: EvolveAssessment;
    objective: EvolveObjective;
  }): Promise<EvolveProposal> {
    const candidateId = `P${evolvePass}`;
    const brief = designerBrief({ ...args, candidateId });
    const promptText = `Act as the sole designer advancing a first-principles reconstruction. Work like a painter applying one layer at a time. This pass adds one deliberate layer of the design. Do not paint the whole picture at once. Let the user see the composition emerge through separate accepted passes. Do not spawn subagents. Call types_get before editing. The reference is read-only evidence for exact text, assets, dimensions, and product intent. Do not copy its coordinates or styling unless that choice independently fits the user direction.

Make one small, coherent construction pass that fulfills only the supplied objective and its completion signal. You may create, rewrite, restyle, resize, reorder, reparent, or delete anything inside the writable reconstruction frame. Keep that frame present and never touch the reference or any layer outside the reconstruction. Use at most five operations and create at most four layers. Do not complete another region early. Leave later work visibly unfinished for later passes. Return absolute values for the current reconstruction. At least one operation array must contain a change. Never return an empty pass.

Return the operations in the required structured format. Figmaboy will decode and validate them before rendering. Convert updates to {kind:"update",id,patch:JSON.parse(patchJson)}, creates to {kind:"create",parentId,node:JSON.parse(nodeJson),index when non-negative}, reorders to {kind:"reorder",parentId,ids}, deletes to {kind:"delete",ids}, and reparents to {kind:"reparent",parentId,ids,index when non-negative}.

${brief}`;
    const baseInput = [textInput(brief), imageInput(args.referenceImage), imageInput(args.currentImage)];
    const activityId = beginEvolveActivity(`Construction pass ${evolvePass}`, args.objective.instruction);
    for (let attempt = 0; attempt < 2 && !evolveCancelled; attempt += 1) {
      try {
        const text = await runEvolveExec("designer", promptText, [
          { name: "reference", dataUrl: args.referenceImage },
          { name: "current-draft", dataUrl: args.currentImage },
        ], designerSchema(), activityId);
        let candidate: ReturnType<typeof designerCandidate>;
        try {
          candidate = designerCandidate(parseAgentJson(text));
        } catch (cause) {
          if (evolveCancelled) throw cause;
          finishEvolveActivity(activityId, "recovering", `The initial proposal needs correction: ${errorMessage(cause)}`);
          const corrected = await correctDesignerProposal({ candidateId, rawText: text, baseInput }, cause);
          finishEvolveActivity(activityId, "complete", "The designer corrected its initial proposal");
          return corrected;
        }
        finishEvolveActivity(activityId, "complete", candidate.summary, [`Hypothesis: ${candidate.hypothesis}`, `Mechanism: ${candidate.mechanism}`, `Tradeoff: ${candidate.intendedTradeoff}`]);
        return { ...candidate, rawText: text, baseInput, candidateId };
      } catch (cause) {
        if (!retryableEvolveError(cause) || evolveCancelled || attempt >= 1) {
          finishEvolveActivity(activityId, "discarded", errorMessage(cause));
          throw cause;
        }
        finishEvolveActivity(activityId, "recovering", evolveRecoveryDetail("designer", cause), evolveRecoveryNotes(cause, attempt + 1));
        await waitForRetry(attempt + 1);
      }
    }
    throw new Error("Evolution stopped");
  }

  async function correctDesignerProposal(proposal: Pick<EvolveProposal, "candidateId" | "rawText" | "baseInput">, cause: unknown): Promise<EvolveProposal> {
    let previousText = proposal.rawText;
    let failure = cause;
    const activityId = beginEvolveActivity(`Correcting pass ${evolvePass}`, errorMessage(cause));
    const images = proposal.baseInput.map(object).filter((item) => item.type === "image" && typeof item.url === "string").map((item, index) => ({ name: index ? "current-draft" : "reference", dataUrl: String(item.url) }));
    const brief = String(proposal.baseInput.map(object).find((item) => item.type === "text")?.text ?? "");
    for (let attempt = 1; attempt <= 2 && !evolveCancelled; attempt += 1) {
      try {
        const correction = `${brief}

Correct the same construction pass. Do not start a different design direction. Call types_get, then repair the proposal using the exact error below. Preserve its title, hypothesis, mechanism, intended tradeoff, and pass objective when they are usable. Use at most five operations and create at most four layers. At least one operation array must contain a change. Figmaboy will validate the complete replacement before rendering. Return only the required structured proposal.

EXACT VALIDATION OR RENDER ERROR
${errorMessage(failure).slice(0, 1_200)}

REJECTED PROPOSAL
${previousText.slice(0, 20_000)}`;
        previousText = await runEvolveExec("correction", correction, images, designerSchema(), activityId);
        const candidate = designerCandidate(parseAgentJson(previousText));
        finishEvolveActivity(activityId, "complete", `Corrected proposal: ${candidate.summary}`, [`Hypothesis: ${candidate.hypothesis}`, `Mechanism: ${candidate.mechanism}`]);
        return { ...candidate, rawText: previousText, baseInput: proposal.baseInput, candidateId: proposal.candidateId };
      } catch (nextCause) {
        if (evolveCancelled) {
          finishEvolveActivity(activityId, "discarded", "Evolution stopped");
          throw nextCause;
        }
        failure = nextCause;
        finishEvolveActivity(activityId, "recovering", attempt < 2 ? `Correction ${attempt} failed: ${errorMessage(nextCause)}` : `Pass could not be corrected: ${errorMessage(nextCause)}`);
        if (attempt < 2 && retryableEvolveError(nextCause)) await waitForRetry(attempt);
      }
    }
    throw failure;
  }

  function candidateAccepted(assessment: EvolveAssessment): boolean {
    return assessment.preference === "image_2" && assessment.confidence >= 0.65 && !assessment.regressions.some((regression) => regression.severity !== "minor");
  }

  function assessmentSatisfied(assessment: EvolveAssessment): boolean {
    return assessment.verdict === "satisfied" && assessment.confidence >= 0.7 && assessment.regions.length === 0 && assessment.criteria.every((criterion) => criterion.status === "met");
  }

  async function compareRenderedCandidate(args: {
    direction: string;
    frame: JsonObject;
    sourceContext: JsonObject;
    referenceImage: string;
    currentImage: string;
    candidate: EvolveRenderedCandidate;
    frozen: EvolveCriterion[];
    objective: EvolveObjective;
  }): Promise<EvolveAssessment> {
    return runDirector({
      direction: args.direction,
      frame: args.frame,
      sourceContext: args.sourceContext,
      draftContext: args.candidate.context,
      referenceImage: args.referenceImage,
      currentImage: args.currentImage,
      candidateImage: args.candidate.image,
      objective: args.objective,
      frozen: args.frozen,
    });
  }

  function renderFingerprint(imageUrl: string): string {
    let hash = 2166136261;
    for (let index = 0; index < imageUrl.length; index += Math.max(1, Math.floor(imageUrl.length / 20_000))) hash = Math.imul(hash ^ imageUrl.charCodeAt(index), 16777619);
    return `${imageUrl.length}:${hash >>> 0}`;
  }

  function journalCandidate(proposal: EvolveProposal, outcome: EvolveJournalCandidate["outcome"], reason: string): EvolveJournalCandidate {
    return { id: proposal.candidateId, title: proposal.title, hypothesis: proposal.hypothesis, mechanism: proposal.mechanism, tradeoff: proposal.intendedTradeoff, outcome, reason: reason.slice(0, 320) };
  }

  function evolutionJournalMarkdown(generations: EvolveJournalGeneration[]): string {
    if (!generations.length) return "";
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    const sections = generations.map((generation) => {
      const candidate = generation.candidate;
      return `### Pass ${generation.generation} · ${candidate.outcome}

Objective: ${clean(generation.objective.instruction)}
Done when: ${clean(generation.objective.completionSignal)}

- Result: ${clean(candidate.title)}
- Hypothesis: ${clean(candidate.hypothesis)}
- Mechanism: ${clean(candidate.mechanism)}
- Tradeoff: ${clean(candidate.tradeoff)}
- Decision: ${clean(candidate.reason)}`;
    });
    return `## Reconstruction journal

${sections.join("\n\n")}`;
  }

  function updateJournalCandidate(generation: EvolveJournalGeneration, patch: Partial<EvolveJournalCandidate>): void {
    generation.candidate = { ...generation.candidate, ...patch };
  }

  async function persistIncompleteEvolutionJournal(status: "stopped" | "error", detail: string): Promise<void> {
    if (evolveJournalPersisted || !evolveParentThreadId || !evolveJournal.length) return;
    const journal = evolutionJournalMarkdown(evolveJournal);
    const message = `Evolution ${status}. ${detail}\n\n${journal}`;
    await injectEvolveHistory(evolveParentThreadId, "assistant", message).catch(() => undefined);
    timeline = { ...timeline, items: [...timeline.items, { id: `local_evolve_${status}_${Date.now()}`, type: "agentMessage", text: message }] };
    evolveJournalPersisted = true;
  }

  async function discardEvolveRun() {
    if (evolveRunId) await callEditor("evolve_run_discard", { runId: evolveRunId }).catch(() => undefined);
  }

  async function cancelEvolveWorkflow() {
    evolveCancelled = true;
    await invoke("codex_evolve_cancel", { runId: evolveRunId }).catch(() => undefined);
    await persistIncompleteEvolutionJournal("stopped", `Stopped after pass ${evolvePass}. The reconstruction keeps ${evolveKept} accepted passes; ${evolveDiscarded} proposals were rejected.`);
    await discardEvolveRun();
    evolveRunning = false;
    evolveRunOutcome = "stopped";
    evolveStage = "idle";
    rpcBusy = false;
  }

  async function runEvolveWorkflow(direction: string, appendUserMessage = true) {
    const workflowEpoch = ++evolveWorkflowEpoch;
    const message = `/evolve ${direction}`;
    prompt = "";
    attachments = [];
    selectedSkills = [];
    lastPrompt = message;
    evolveRunning = true;
    evolveRunOutcome = "running";
    evolveCancelled = false;
    evolveRunId = crypto.randomUUID();
    evolveStage = "capture";
    evolvePass = 0;
    evolveKept = 0;
    evolveDiscarded = 0;
    evolveActivities = [];
    evolveJournal = [];
    evolveJournalPersisted = false;
    evolveParentThreadId = "";
    timeline = { ...timeline, error: "", items: appendUserMessage ? [...timeline.items, { id: `local_${Date.now()}`, type: "userMessage", content: [{ type: "text", text: message, text_elements: [] }] }] : timeline.items };
    pinnedToBottom = true;
    setAttention("working");
    const captureActivity = beginEvolveActivity("Preparing the reconstruction");
    let workflowFailure = "";

    try {
      const createdParentThread = currentThreadId === null;
      const parentThreadId = await ensureThread();
      evolveParentThreadId = parentThreadId;
      if (appendUserMessage) {
        await injectEvolveHistory(parentThreadId, "user", message);
        if (createdParentThread) await renameThread(parentThreadId, direction.slice(0, 72));
      }

      const status = await callEditor("editor_status");
      const selectedIds = Array.isArray(status.selectedIds) ? status.selectedIds.filter((id): id is string => typeof id === "string") : [];
      if (selectedIds.length !== 1) throw new Error("Select exactly one frame in Figmaboy, then run /evolve again.");
      const sourceFrameId = selectedIds[0];
      const sourceDocumentResult = await callEditor("document_get");
      const sourceDocument = object(sourceDocumentResult.document);
      const sourceFrame = object(object(sourceDocument.nodes)[sourceFrameId]);
      if (sourceFrame.type !== "frame") throw new Error("Select a frame, not an individual layer, then run /evolve again.");
      const pageEpoch = Number(sourceDocumentResult.pageEpoch ?? status.pageEpoch ?? 0);
      const sourceContext = frameContext(sourceDocument, sourceFrameId);
      await callEditor("geometry_get", { ids: Object.keys(object(sourceContext.nodes)) });
      const referenceImage = await captureEvolveFrame(sourceFrameId);
      if (evolveCancelled) return;

      const reconstruction = await callEditor("evolve_reconstruction_start", {
        runId: evolveRunId,
        sourceFrameId,
        expectedChangeToken: Number(sourceDocumentResult.changeToken),
        pageEpoch,
      });
      const draftFrameId = String(reconstruction.draftFrameId ?? "");
      if (!draftFrameId) throw new Error("Figmaboy could not create the reconstruction frame");
      let changeToken = Number(reconstruction.changeToken);
      let currentDocument = object(reconstruction.document);
      let draftFrame = object(object(currentDocument.nodes)[draftFrameId]);
      if (draftFrame.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the reconstruction frame was not created");
      let draftContext = frameContext(currentDocument, draftFrameId);
      let currentImage = await captureEvolveFrame(draftFrameId);
      finishEvolveActivity(captureActivity, "complete", "The reference is frozen and an empty reconstruction frame is ready beside it", ["The source frame will remain unchanged", "Accepted passes will appear on the reconstruction frame"]);

      let assessment: EvolveAssessment | null = null;
      let frozenCriteria: EvolveCriterion[] | null = null;
      let satisfactionVotes = 0;
      let finalSummary = "The reconstruction satisfies the requested direction.";
      const renderHistory = new Set([renderFingerprint(currentImage)]);

      while (!evolveCancelled) {
        const liveDocumentResult = await callEditor("document_get");
        if (Number(liveDocumentResult.changeToken) !== changeToken) {
          const liveDocument = object(liveDocumentResult.document);
          const liveDraft = object(object(liveDocument.nodes)[draftFrameId]);
          if (liveDraft.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the reconstruction frame was removed");
          changeToken = Number(liveDocumentResult.changeToken);
          currentDocument = liveDocument;
          draftFrame = liveDraft;
          draftContext = frameContext(liveDocument, draftFrameId);
          currentImage = await captureEvolveFrame(draftFrameId);
          assessment = null;
          satisfactionVotes = 0;
          await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
          const continued = beginEvolveActivity("Continuing from the current reconstruction");
          finishEvolveActivity(continued, "complete", "Your canvas edits became the next construction base. The frozen reference did not change.");
        }

        if (!assessment) {
          evolveStage = satisfactionVotes ? "verify" : "review";
          assessment = await runDirector({
            direction,
            frame: draftFrame,
            sourceContext,
            draftContext,
            referenceImage,
            currentImage,
            frozen: frozenCriteria,
            verification: satisfactionVotes > 0,
          });
          if (!frozenCriteria) frozenCriteria = assessment.criteria.map(({ id, requirement }) => ({ id, requirement, status: "unmet", evidence: "Frozen direction criterion" }));
        }
        if (evolveCancelled) return;
        if (assessmentSatisfied(assessment)) {
          satisfactionVotes += 1;
          if (satisfactionVotes >= 2) break;
          assessment = null;
          continue;
        }
        satisfactionVotes = 0;
        const objective = assessment.nextObjective;
        if (!objective) {
          assessment = null;
          continue;
        }

        evolvePass += 1;
        evolveStage = "design";
        let proposal = await runDesigner({
          direction,
          sourceFrameId,
          draftFrameId,
          sourceContext,
          draftContext,
          referenceImage,
          currentImage,
          assessment,
          objective,
        });
        const generationRecord: EvolveJournalGeneration = {
          generation: evolvePass,
          objective: structuredClone(objective),
          candidate: journalCandidate(proposal, "pending", "Waiting for isolated rendering and review"),
        };

        evolveStage = "preview";
        const renderActivity = beginEvolveActivity(`Rendering pass ${evolvePass}`);
        let rendered!: EvolveRenderedCandidate;
        let correctionRounds = 0;
        while (!evolveCancelled) {
          try {
            const validation = await callEditor("evolve_candidate_validate", {
              runId: evolveRunId,
              candidateId: proposal.candidateId,
              operations: proposal.operations,
            });
            const validationToken = typeof validation.validationToken === "string" ? validation.validationToken : "";
            if (!validationToken) throw new Error("Figmaboy validation returned no candidate receipt");
            const result = await callEditor("evolve_candidate_render", {
              runId: evolveRunId,
              candidateId: proposal.candidateId,
              operations: proposal.operations,
              validationToken,
            });
            rendered = {
              proposal,
              image: screenshotDataUrl(result),
              thumbnail: thumbnailDataUrl(result),
              context: frameContext(result.document, draftFrameId),
            };
            updateEvolveActivity(renderActivity, { image: rendered.thumbnail });
            finishEvolveActivity(renderActivity, "complete", "The proposed pass rendered in an isolated canvas", [proposal.hypothesis, `Mechanism: ${proposal.mechanism}`]);
            break;
          } catch (cause) {
            const message = errorMessage(cause);
            if (/STALE_DOCUMENT|EVOLVE_PAGE_CHANGED|EVOLVE_NEEDS_FRAME/.test(message)) throw cause;
            if (correctionRounds >= 2) throw new Error(`Construction pass ${evolvePass} failed after two corrections: ${message}`);
            correctionRounds += 1;
            finishEvolveActivity(renderActivity, "recovering", `Pass rejected by the canvas: ${message}`);
            proposal = await correctDesignerProposal(proposal, cause);
            generationRecord.candidate = journalCandidate(proposal, "pending", "Corrected proposal is waiting for review");
          }
        }
        if (evolveCancelled) return;

        const fingerprint = renderFingerprint(rendered.image);
        if (renderHistory.has(fingerprint)) {
          evolveDiscarded += 1;
          updateJournalCandidate(generationRecord, { outcome: "duplicate", reason: "The pass reproduced an earlier reconstruction" });
          evolveJournal = [...evolveJournal, generationRecord];
          const duplicate = beginEvolveActivity(`Pass ${evolvePass} made no visible progress`);
          finishEvolveActivity(duplicate, "discarded", "The next director will choose a different construction objective");
          assessment = null;
          await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
          continue;
        }
        renderHistory.add(fingerprint);

        evolveStage = "compare";
        const comparison = await compareRenderedCandidate({
          direction,
          frame: draftFrame,
          sourceContext,
          referenceImage,
          currentImage,
          candidate: rendered,
          frozen: frozenCriteria ?? assessment.criteria,
          objective,
        });
        rendered.comparison = comparison;
        if (!candidateAccepted(comparison)) {
          evolveDiscarded += 1;
          updateJournalCandidate(generationRecord, { outcome: "rejected", reason: comparison.summary });
          evolveJournal = [...evolveJournal, generationRecord];
          const rejected = beginEvolveActivity(`Pass ${evolvePass} kept the current reconstruction`);
          finishEvolveActivity(rejected, "discarded", comparison.summary, comparison.regressions.map((regression) => regression.note));
          assessment = null;
          await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
          continue;
        }

        let committed: JsonObject;
        try {
          committed = await callEditor("evolve_candidate_commit", { runId: evolveRunId, candidateId: proposal.candidateId });
        } catch (cause) {
          if (!/EVOLVE_REBASE_CONFLICT/.test(errorMessage(cause))) throw cause;
          evolveDiscarded += 1;
          updateJournalCandidate(generationRecord, { outcome: "superseded", reason: "Your edits changed the same properties before this pass could commit" });
          evolveJournal = [...evolveJournal, generationRecord];
          const current = await callEditor("document_get");
          changeToken = Number(current.changeToken);
          currentDocument = object(current.document);
          draftFrame = object(object(currentDocument.nodes)[draftFrameId]);
          if (draftFrame.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the reconstruction frame was removed");
          draftContext = frameContext(currentDocument, draftFrameId);
          currentImage = await captureEvolveFrame(draftFrameId);
          assessment = null;
          await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
          continue;
        }

        if (committed.needsReview === true) {
          const current = await callEditor("document_get");
          const liveDocument = object(current.document);
          const liveFrame = object(object(liveDocument.nodes)[draftFrameId]);
          if (liveFrame.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the reconstruction frame was removed");
          const liveImage = await captureEvolveFrame(draftFrameId);
          const rebased: EvolveRenderedCandidate = {
            proposal,
            image: screenshotDataUrl(committed),
            thumbnail: thumbnailDataUrl(committed),
            context: frameContext(committed.document, draftFrameId),
          };
          const rebaseAssessment = await compareRenderedCandidate({
            direction,
            frame: liveFrame,
            sourceContext,
            referenceImage,
            currentImage: liveImage,
            candidate: rebased,
            frozen: frozenCriteria ?? assessment.criteria,
            objective,
          });
          if (!candidateAccepted(rebaseAssessment)) {
            evolveDiscarded += 1;
            updateJournalCandidate(generationRecord, { outcome: "superseded", reason: "The pass no longer improved the user-edited reconstruction" });
            evolveJournal = [...evolveJournal, generationRecord];
            changeToken = Number(current.changeToken);
            currentDocument = liveDocument;
            draftFrame = liveFrame;
            draftContext = frameContext(liveDocument, draftFrameId);
            currentImage = liveImage;
            assessment = null;
            await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
            continue;
          }
          rendered = { ...rebased, comparison: rebaseAssessment };
          committed = await callEditor("evolve_candidate_commit", { runId: evolveRunId, candidateId: proposal.candidateId });
        }
        if (evolveCancelled) return;

        changeToken = Number(committed.changeToken);
        const committedDocumentResult = await callEditor("document_get");
        currentDocument = object(committedDocumentResult.document);
        draftFrame = object(object(currentDocument.nodes)[draftFrameId]);
        if (draftFrame.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the reconstruction frame was removed");
        draftContext = frameContext(currentDocument, draftFrameId);
        currentImage = await captureEvolveFrame(draftFrameId);
        updateJournalCandidate(generationRecord, { outcome: "accepted", reason: rendered.comparison?.summary ?? "The pass advanced its construction objective" });
        evolveJournal = [...evolveJournal, generationRecord];
        assessment = null;
        finalSummary = `${proposal.title}: ${proposal.summary}`;
        evolveKept += 1;
        const kept = beginEvolveActivity(`Pass ${evolvePass} applied to the reconstruction`);
        updateEvolveActivity(kept, { image: rendered.thumbnail });
        finishEvolveActivity(kept, "kept", proposal.summary, [`Objective: ${objective.instruction}`, `Done when: ${objective.completionSignal}`, `Mechanism: ${proposal.mechanism}`]);
        await callEditor("evolve_run_start", { runId: evolveRunId, frameId: draftFrameId, expectedChangeToken: changeToken, pageEpoch });
      }

      if (evolveCancelled) return;
      evolveStage = "commit";
      await discardEvolveRun();
      evolveRunOutcome = "complete";
      const journal = evolutionJournalMarkdown(evolveJournal);
      const resultMessage = `${finalSummary}

Reconstructed beside the original through ${evolvePass} ${evolvePass === 1 ? "pass" : "passes"}. ${evolveKept} accepted and ${evolveDiscarded} rejected. Two fresh directors agreed that the requested direction is satisfied.${journal ? `\n\n${journal}` : ""}`;
      await injectEvolveHistory(parentThreadId, "assistant", resultMessage);
      evolveJournalPersisted = true;
      timeline = { ...timeline, items: [...timeline.items, { id: `local_evolve_${Date.now()}`, type: "agentMessage", text: resultMessage }] };
      void refreshThreads();
      setAttention("idle");
    } catch (cause) {
      const failure = errorMessage(cause);
      if (!evolveCancelled) await persistIncompleteEvolutionJournal("error", failure);
      await discardEvolveRun();
      if (!evolveCancelled) {
        workflowFailure = failure;
        evolveRunOutcome = "error";
      }
    } finally {
      if (workflowEpoch === evolveWorkflowEpoch) {
        evolveRunning = false;
        evolveStage = "idle";
        rpcBusy = false;
        evolveExecActivities.clear();
      }
    }
    if (workflowFailure && workflowEpoch === evolveWorkflowEpoch) {
      timeline = { ...timeline, activeTurnId: null, error: workflowFailure };
      setAttention("error");
    }
  }

  async function ensureThread(): Promise<string> {
    if (currentThreadId) return currentThreadId;
    const response = await request<{ thread: CodexThread; model?: string; serviceTier?: string | null; reasoningEffort?: string | null }>("thread/start", approvalParams({
      cwd,
      model: selection.model || undefined,
      serviceTier: selection.serviceTier === "default" ? null : selection.serviceTier,
      serviceName: "figmaboy",
      developerInstructions: figmaboyDeveloperInstructions(),
    }));
    currentThreadId = response.thread.id;
    selection = resolveCodexSelection(models, { model: response.model ?? selection.model, effort: response.reasoningEffort ?? selection.effort, serviceTier: response.serviceTier ?? selection.serviceTier });
    threads = [response.thread, ...threads.filter((thread) => thread.id !== response.thread.id)];
    return response.thread.id;
  }

  function skillPattern(name: string): RegExp {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\$${escaped}(?=$|[^A-Za-z0-9_-])`);
  }

  function skillsForPrompt(text: string): Skill[] {
    const included: Skill[] = [];
    for (const skill of [...skills, ...selectedSkills]) {
      if (skillPattern(skill.name).test(text) && !included.some((item) => item.name === skill.name)) included.push(skill);
    }
    return included;
  }

  function turnInput(text: string, sentAttachments: CodexAttachment[], sentSkills: Skill[]) {
    const inputs: JsonObject[] = [{ type: "text", text, text_elements: [] }];
    for (const attachment of sentAttachments) inputs.push({ type: "localImage", path: attachment.path });
    for (const skill of sentSkills) inputs.push({ type: "skill", name: skill.name, path: skill.path });
    return inputs;
  }

  async function send(value = prompt) {
    const direction = evolveDirection(value);
    if (direction !== null) {
      const command = COMPOSER_COMMANDS.find((item) => item.action === "evolve");
      if (command) await runCommand(command, direction);
      return;
    }
    const sentSkills = skillsForPrompt(value);
    const text = value;
    if ((!text.trim() && attachments.length === 0) || connection !== "ready" || rpcBusy || account === null || blockedByRequest) return;
    const sentAttachments = attachments;
    if (!evolveRunning && evolveActivities.length) { evolveActivities = []; evolveRunOutcome = null; evolveJournal = []; evolveParentThreadId = ""; }
    const fallback = "Use the attached image as a visual reference for the open design.";
    const input = turnInput(text || fallback, sentAttachments, sentSkills);
    prompt = "";
    attachments = [];
    selectedSkills = [];
    lastPrompt = text;
    timeline = { ...timeline, error: "", items: [...timeline.items, { id: `local_${Date.now()}`, type: "userMessage", content: input }] };
    pinnedToBottom = true;
    rpcBusy = true;
    try {
      const threadId = await ensureThread();
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
      prompt = text;
      attachments = sentAttachments;
      selectedSkills = sentSkills;
      timeline = { ...timeline, activeTurnId: null, error: errorMessage(cause) };
      setAttention("error");
    } finally {
      rpcBusy = false;
    }
  }

  async function retryLastTurn() {
    const direction = evolveDirection(lastPrompt);
    if (direction !== null) await runEvolveWorkflow(direction, false);
    else await send(lastPrompt);
  }

  async function stop() {
    if (evolveRunning) { await cancelEvolveWorkflow(); return; }
    if (!currentThreadId || !timeline.activeTurnId) return;
    rpcBusy = true;
    try { await request("turn/interrupt", { threadId: currentThreadId, turnId: timeline.activeTurnId }); }
    catch (cause) { timeline = { ...timeline, error: errorMessage(cause) }; }
    finally { rpcBusy = false; }
  }

  async function runCommand(command: ComposerCommand, argument = "") {
    if (command.action === "new") { newChat(); return; }
    if (command.action === "review") { prompt = "Review the current design, fix the most important visual issues, capture a final frame screenshot, and summarize the changes."; await send(); return; }
    if (command.action === "evolve") {
      if (working || rpcBusy || evolveRunning) { connectionError = "Wait for the current Codex turn to finish before evolving a frame."; return; }
      const direction = argument.trim() || "Improve its visual hierarchy, spacing, and clarity while preserving the existing content and intent.";
      await runEvolveWorkflow(direction);
      return;
    }
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

  function chooseSuggestion(suggestion: (typeof suggestions)[number]) {
    if (!trigger) return;
    if (suggestion.kind === "command") {
      const command = suggestion.value as ComposerCommand;
      if (command.action === "evolve") { prompt = "/evolve "; void tick().then(() => composer?.focus()); return; }
      prompt = "";
      void runCommand(command);
      return;
    }
    if (suggestion.kind === "skill") {
      const skill = suggestion.value as Skill;
      if (!selectedSkills.some((item) => item.name === skill.name)) selectedSkills = [...selectedSkills, skill];
      const replacement = `$${skill.name}`;
      const suffixHadSpace = prompt.slice(trigger.end).startsWith(" ");
      prompt = replaceComposerTrigger(prompt, trigger.start, replacement, trigger.end);
      composerCursor = trigger.start + replacement.length + (suffixHadSpace ? 0 : 1);
    } else {
      const replacement = String(suggestion.value);
      const suffixHadSpace = prompt.slice(trigger.end).startsWith(" ");
      prompt = replaceComposerTrigger(prompt, trigger.start, replacement, trigger.end);
      composerCursor = trigger.start + replacement.length + (suffixHadSpace ? 0 : 1);
    }
    void tick().then(() => { composer?.focus(); composer?.setSelectionRange(composerCursor, composerCursor); });
  }

  async function addAttachmentFiles(files: File[]) {
    if (!supportsImages) { connectionError = "The selected model does not accept images."; return; }
    for (const file of files) {
      if (!file.type.startsWith("image/")) { connectionError = `${file.name} is not an image.`; continue; }
      try {
        const { dataUrl, extension, converted } = await attachmentDataUrl(file);
        const originalName = file.name.trim();
        const name = originalName
          ? converted ? `${originalName.replace(/\.[^.]+$/, "") || "pasted-image"}.png` : originalName
          : `pasted-image-${Date.now()}.${extension}`;
        await addAttachmentDataUrl(name, dataUrl);
      } catch (cause) { connectionError = errorMessage(cause); }
    }
  }

  async function addAttachmentDataUrl(name: string, dataUrl: string) {
    const saved = await invoke<{ path: string; mime: string; name: string }>("codex_attachment_save", { workspaceId, name, dataUrl });
    attachments = [...attachments, { id: crypto.randomUUID(), ...saved, previewUrl: dataUrl }];
  }

  async function attachmentDataUrl(file: File): Promise<{ dataUrl: string; extension: string; converted: boolean }> {
    if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp") {
      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
      return { dataUrl: await readFileDataUrl(file), extension, converted: false };
    }
    if (typeof createImageBitmap !== "function") throw new Error("Paste a PNG, JPEG, or WebP image.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not convert the pasted image.");
      context.drawImage(bitmap, 0, 0);
      return { dataUrl: canvas.toDataURL("image/png"), extension: "png", converted: true };
    } finally { bitmap.close(); }
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
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const itemImages = [...clipboard.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const fileImages = [...clipboard.files].filter((file) => file.type.startsWith("image/"));
    const images = itemImages.length ? itemImages : fileImages;
    if (!images.length) return;
    event.preventDefault();
    void addAttachmentFiles(images);
  }

  async function pasteNativeClipboard() {
    if (nativePasteBusy) return;
    nativePasteBusy = true;
    const requestedPrompt = prompt;
    const requestedStart = composer?.selectionStart ?? prompt.length;
    const requestedEnd = composer?.selectionEnd ?? requestedStart;
    try {
      const content = await invoke<NativeClipboardContent>("codex_clipboard_read");
      if (content.kind === "image") {
        if (!supportsImages) throw new Error("The selected model does not accept images.");
        const dataUrl = content.dataUrl ?? content.data_url;
        if (!dataUrl) throw new Error("The clipboard image did not include image data.");
        await addAttachmentDataUrl(content.name, dataUrl);
      }
      if (content.kind === "text") {
        const start = prompt === requestedPrompt ? requestedStart : composer?.selectionStart ?? prompt.length;
        const end = prompt === requestedPrompt ? requestedEnd : composer?.selectionEnd ?? start;
        prompt = `${prompt.slice(0, start)}${content.text}${prompt.slice(end)}`;
        const cursor = start + content.text.length;
        composerCursor = cursor;
        await tick();
        composer?.focus();
        composer?.setSelectionRange(cursor, cursor);
      }
    } catch (cause) { connectionError = errorMessage(cause); }
    finally { nativePasteBusy = false; }
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

  function continueMarkdownList(event: KeyboardEvent): boolean {
    if (!event.shiftKey || event.key !== "Enter" || event.isComposing || !composer) return false;
    const start = composer.selectionStart;
    const end = composer.selectionEnd;
    const lineStart = prompt.lastIndexOf("\n", start - 1) + 1;
    const line = prompt.slice(lineStart, start);
    const match = /^(\s*)([-*+]|(\d+)[.)]|>)\s+(.*)$/.exec(line);
    if (!match) return false;
    event.preventDefault();
    const content = match[4] ?? "";
    if (!content.trim()) {
      prompt = `${prompt.slice(0, lineStart)}\n${prompt.slice(end)}`;
      composerCursor = lineStart + 1;
      void tick().then(() => composer.setSelectionRange(composerCursor, composerCursor));
      return true;
    }
    const marker = match[3] ? `${Number(match[3]) + 1}${match[2].endsWith(")") ? ")" : "."}` : match[2];
    const insertion = `\n${match[1]}${marker} `;
    prompt = `${prompt.slice(0, start)}${insertion}${prompt.slice(end)}`;
    const cursor = start + insertion.length;
    composerCursor = cursor;
    void tick().then(() => composer.setSelectionRange(cursor, cursor));
    return true;
  }

  function syncComposerCursor() {
    if (composer) composerCursor = composer.selectionStart;
  }

  function onComposerKeydown(event: KeyboardEvent) {
    syncComposerCursor();
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v" && /Linux/i.test(navigator.userAgent) && "__TAURI_INTERNALS__" in window) {
      event.preventDefault();
      void pasteNativeClipboard();
      return;
    }
    if (trigger && suggestions.length) {
      if (event.key === "ArrowDown") { event.preventDefault(); suggestionIndex = Math.min(suggestions.length - 1, suggestionIndex + 1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); suggestionIndex = Math.max(0, suggestionIndex - 1); return; }
      if (event.key === "Enter" && !event.shiftKey && suggestions[suggestionIndex]) { event.preventDefault(); chooseSuggestion(suggestions[suggestionIndex]); return; }
    }
    if (continueMarkdownList(event)) return;
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

  function userPromptClipboard(content: unknown): string {
    const text = inputText(content);
    const missingSkillLines = inputSkills(content).filter((name) => !skillPattern(name).test(text)).map((name) => `$${name}`);
    return [text, ...missingSkillLines].filter(Boolean).join("\n");
  }

  function userMessageMarkdown(content: unknown): string {
    return userPromptClipboard(content);
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

<aside class="codex-sidebar" class:visible class:embedded aria-label="Codex chat" ondragover={(event) => event.preventDefault()} ondrop={onDrop}>
  <header class="sidebar-head">
    <div class="header-spacer"></div>
    {#if currentThread}<button title="Rename chat" ondblclick={() => renameThread(currentThread.id)} onclick={() => (historyMenu = historyMenu === currentThread.id ? null : currentThread.id)}><MoreHorizontal size={15} /></button>{/if}
    <button title="Chat history" class:active={historyOpen} disabled={evolveRunning} onclick={() => (historyOpen = !historyOpen)}><History size={15} /></button>
    <button title="New chat" disabled={evolveRunning} onclick={newChat}><Plus size={16} /></button>
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
            <div class="message user"><div><MarkdownText text={userMessageMarkdown(row.item.content)} skills={inputSkills(row.item.content)} /><button class="copy-prompt" aria-label="Copy prompt" title="Copy prompt" onclick={() => copyMessage(row.item.id, userPromptClipboard(row.item.content))}>{#if copiedMessage === row.item.id}<Check size={13} />{:else}<Copy size={13} />{/if}</button></div></div>
          {:else if row.item.type === "agentMessage"}
            <article class="message assistant"><div class="assistant-body"><MarkdownText text={String(row.item.text ?? "")} />{#if row.item.text}<button class="copy-message" title="Copy response" onclick={() => copyMessage(row.item.id, String(row.item.text))}>{#if copiedMessage === row.item.id}<Check size={13} />{:else}<Copy size={13} />{/if}</button>{/if}{#if terminalAgent(row.item) && turnMeta(row.item)?.status !== "inProgress"}<div class="turn-meta">{#if timeline.usage}<span>{formatTokenCount(timeline.usage.totalTokens)} context tokens</span>{/if}<button title="Undo the last Figmaboy change" onclick={() => runCommand(COMPOSER_COMMANDS.find((command) => command.action === "undo")!)}><Undo2 size={11} />Undo last change</button></div>{/if}</div></article>
          {:else if row.item.type === "reasoning" && itemText(row.item)}
            <details class="reasoning" open={working}><summary><LoaderCircle class={working ? "spin" : undefined} size={12} /><span>{working ? "Thinking" : "Reasoning"}</span><ChevronDown size={11} /></summary><p>{itemText(row.item)}</p></details>
          {:else if row.item.type === "plan" && itemText(row.item)}
            <details class="plan" open><summary><MessageSquareText size={12} /><span>Plan</span><ChevronDown size={11} /></summary><div><MarkdownText text={itemText(row.item)} />{#if !working}<div class="plan-actions"><button onclick={() => implementPlan(itemText(row.item), false)}>Implement</button><button onclick={() => implementPlan(itemText(row.item), true)}>Implement in new chat</button></div>{/if}</div></details>
          {/if}
        {/each}
        {#if evolveActivities.length}<EvolveProgress stage={evolveStage} stageLabel={evolveCardLabel} pass={evolvePass} kept={evolveKept} discarded={evolveDiscarded} activities={evolveActivities} outcome={evolveRunOutcome} />{/if}
        {#if working}<div class="working"><LoaderCircle class="spin" size={13} /> Codex is working</div>{/if}
        {#if timeline.error && dismissedTurnError !== timeline.error}<div class="turn-error"><button title="Dismiss error" onclick={() => (dismissedTurnError = timeline.error)}><X size={12} /></button><strong>Codex stopped</strong><p>{timeline.error}</p>{#if lastPrompt}<button class="retry" onclick={retryLastTurn}><RotateCcw size={12} /> Retry</button>{/if}</div>{/if}
      </div>
    {/if}
  </div>

  {#if !pinnedToBottom}<button class="jump-latest" onclick={() => scrollToLatest()}><ChevronDown size={13} /> Latest</button>{/if}

  <footer class="composer-wrap">
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
          <header><Wrench size={13} /><strong>{activeApproval?.title}</strong>{#if currentPending.length > 1}<span>1/{currentPending.length}</span>{/if}</header>
          <p>{activeApproval?.summary}</p>
          {#if activeApproval?.details.length}<ul class="pending-scopes">{#each activeApproval.details as detail}<li>{detail}</li>{/each}</ul>{/if}
          {#if activeApproval?.command}<pre>{activeApproval.command}</pre>{/if}
          <div class="pending-actions"><button disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "cancel")}>Cancel</button><button class="decline" disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "decline")}>Decline</button><button disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "acceptForSession")}>Always allow</button><button class="approve" disabled={respondingRequestId === activePending.id} onclick={() => answerRequest(activePending, "accept")}>Approve</button></div>
        {/if}
      </section>
    {/if}

    <div class="composer" class:disabled={connection !== "ready" || account === null || blockedByRequest || evolveRunning}>
      {#if attachments.length}<div class="attachment-strip">{#each attachments as attachment (attachment.id)}<div>{#if attachment.previewUrl}<img src={attachment.previewUrl} alt="" />{:else}<FileImage size={15} />{/if}<span title={attachment.name}>{attachment.name}</span><button title="Remove attachment" onclick={() => (attachments = attachments.filter((item) => item.id !== attachment.id))}><X size={11} /></button></div>{/each}</div>{/if}
      <div class="prompt-editor">
        <div class="prompt-mirror" aria-hidden="true"><div style:transform={`translateY(${-composerScrollTop}px)`}>{#each promptSegments as segment}{#if segment.type === "skill"}<span class="prompt-skill">{segment.value}</span>{:else}{segment.value}{/if}{/each}<span class="mirror-caret-space">&#8203;</span></div></div>
        <textarea aria-label="Message Codex" aria-controls={trigger && suggestions.length ? "composer-suggestions" : undefined} aria-activedescendant={trigger && suggestions[suggestionIndex] ? `composer-suggestion-${suggestionIndex}` : undefined} bind:this={composer} bind:value={prompt} oninput={syncComposerCursor} onselect={syncComposerCursor} onclick={syncComposerCursor} onkeyup={syncComposerCursor} onscroll={(event) => (composerScrollTop = event.currentTarget.scrollTop)} onkeydown={onComposerKeydown} onpaste={onPaste} placeholder={blockedByRequest ? "Resolve the request above to continue" : evolveRunning ? "Evolving the selected frame…" : working ? "Steer Codex while it works…" : "Ask anything about this design"} rows="1" disabled={connection !== "ready" || account === null || blockedByRequest || evolveRunning}></textarea>
      </div>
      {#if trigger && suggestions.length}<div class="command-menu" id="composer-suggestions" role="listbox">{#each suggestions as suggestion, index}<button id={`composer-suggestion-${index}`} role="option" aria-selected={index === suggestionIndex} class:highlighted={index === suggestionIndex} class:skill-row={suggestion.kind === "skill"} onpointerdown={(event) => event.preventDefault()} onmouseenter={() => (suggestionIndex = index)} onclick={() => chooseSuggestion(suggestion)}><strong>{suggestion.label}</strong>{#if suggestion.description}<span>{suggestion.description}</span>{/if}</button>{/each}</div>{/if}
      <div class="composer-controls">
        <input bind:this={attachmentInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onchange={(event) => { void addAttachmentFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
        <button class="attach" aria-label="Attach image" title={supportsImages ? "Attach image" : "This model does not accept images"} disabled={blockedByRequest || !supportsImages} onclick={() => attachmentInput.click()}><Plus size={16} /></button>
        <button class="stash" aria-label="Prompt stash" title={prompt.trim() ? "Stash this prompt" : uiState.promptStash.length ? `Restore stashed prompt (${uiState.promptStash.length})` : "No stashed prompts"} disabled={!prompt.trim() && !uiState.promptStash.length} onclick={stashPrompt}><Clock3 size={14} /></button>
        <span class="control-spacer"></span>
        <CodexModelPicker {models} selected={selection.model} disabled={working || rpcBusy || evolveRunning} onSelect={(model) => updateSelection({ ...selection, model })} />
        <CodexTraitsPicker model={activeModel} {selection} {approvalMode} disabled={working || rpcBusy || evolveRunning} onChange={updateSelection} onApprovalModeChange={updateApprovalMode} />
        {#if timeline.usage}<CodexContextMeter usage={timeline.usage} {compacting} onCompact={() => runCommand(COMPOSER_COMMANDS.find((command) => command.action === "compact")!)} />{/if}
        {#if working || evolveRunning}<button class="stop" aria-label="Stop Codex" title="Stop the active turn" disabled={rpcBusy} onclick={stop}><Square size={10} weight="fill" /></button>{/if}
        <button class="send" aria-label={working ? "Steer Codex" : "Send message"} title={sendDisabledReason ?? (working ? "Steer Codex" : "Send (Enter)")} disabled={sendDisabledReason !== null} onclick={() => send()}>{#if rpcBusy}<LoaderCircle class="spin" size={14} />{:else}<Send size={15} weight="bold" />{/if}</button>
      </div>
    </div>
    <div class="footer-meta"><span>{evolveRunning ? "Reconstructing beside the frozen reference" : working ? "You can steer the active turn" : "Working locally"}</span><kbd>Markdown · Shift ↵ newline</kbd></div>
  </footer>
</aside>

<style>
  .codex-sidebar { position: absolute; z-index: 31; inset: 0 0 0 auto; width: var(--codex-panel-width,390px); display: none; flex-direction: column; overflow: visible; background: #222224; border-left: 1px solid #414146; color: #ececef; box-shadow: -8px 0 24px #0002; }.codex-sidebar.visible { display: flex; }.codex-sidebar.embedded { position: relative; z-index: auto; inset: auto; width: 100%; height: 100%; border-left: 0; box-shadow: none; }
  .sidebar-head { height: 42px; flex: 0 0 42px; display: flex; align-items: center; gap: 2px; padding: 0 8px; border-bottom: 1px solid #3a3a3f; background: #272729; }.header-spacer { flex: 1; }.sidebar-head > button { width: 31px; height: 31px; border: 0; border-radius: 6px; background: transparent; color: #9999a1; display: grid; place-items: center; cursor: pointer; }.sidebar-head > button:hover,.sidebar-head > button.active { color: white; background: #39393e; }.header-menu { position: absolute; z-index: 40; top: 38px; right: 70px; width: 138px; padding: 5px; border: 1px solid #46464d; border-radius: 7px; background: #29292d; box-shadow: 0 12px 35px #000a; }.header-menu button,.thread-menu button { width: 100%; height: 31px; border: 0; border-radius: 4px; background: transparent; color: #ddd; text-align: left; cursor: pointer; font-size: var(--text-control); }.header-menu button:hover,.thread-menu button:hover { background: #3b3b41; }.header-menu .danger,.thread-menu .danger { color: #fca5a5; }
  .sidebar-head > button:disabled { opacity: .35; cursor: default; }.sidebar-head > button:disabled:hover { color: #9999a1; background: transparent; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #4b4b51 transparent; }.timeline { padding: 19px 18px 32px; display: flex; flex-direction: column; gap: 8px; }
  .center-state { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; text-align: center; color: #9999a2; }.center-state strong { color: #ededf0; font-size: var(--text-emphasis); }.center-state p { max-width: 245px; margin: 6px 0 14px; font-size: var(--text-small); line-height: var(--leading-body); }.center-state button,.center-state a { min-height: 31px; padding: 0 11px; border: 1px solid #4b4b52; border-radius: 6px; background: #333338; color: white; display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--text-small); text-decoration: none; }.center-state a { margin-top: 7px; background: transparent; }
  .empty-chat { min-height: 100%; position: relative; display: flex; flex-direction: column; }.recent-chats { padding: 16px 13px 0; }.recent-chats header { height: 24px; display: flex; align-items: center; justify-content: space-between; color: #8b8b92; font-size: var(--text-control); }.recent-chats header button { border: 0; background: transparent; color: #696970; cursor: pointer; font: inherit; }.recent-chats header button:hover { color: #c5c5ca; }.recent-row { width: 100%; height: 32px; padding: 0 1px; border: 0; border-radius: 5px; background: transparent; color: #c7c7cc; display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer; }.recent-row:hover { padding: 0 7px; background: #29292c; }.recent-row span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-body); }.recent-row time { flex: 0 0 auto; color: #77777e; font-size: var(--text-small); }
  .message.user { display: flex; justify-content: flex-end; margin: 7px 0 16px; }.message.user > div { position: relative; max-width: 82%; padding: 12px 15px; border: 0; border-radius: 17px; background: #2d2d30; color: #eeeeef; box-shadow: inset 0 0 0 1px #ffffff08; font-size: var(--text-body); line-height: var(--leading-body); overflow-wrap: anywhere; user-select: text; }.copy-prompt { position: absolute; left: -31px; bottom: 4px; width: 27px; height: 27px; border: 0; border-radius: 5px; background: transparent; color: #777780; display: grid; place-items: center; cursor: pointer; opacity: 0; }.message.user:hover .copy-prompt,.copy-prompt:focus { opacity: 1; }.copy-prompt:hover { background: #313136; color: #ddd; }.message.assistant { display: block; min-width: 0; margin: 4px 0 12px; }.assistant-body { position: relative; min-width: 0; padding: 1px 29px 0 2px; user-select: text; }.copy-message { position: absolute; top: 0; right: 0; width: 27px; height: 27px; border: 0; border-radius: 5px; background: transparent; color: #777780; display: grid; place-items: center; cursor: pointer; opacity: 0; }.assistant:hover .copy-message,.copy-message:focus { opacity: 1; }.copy-message:hover { background: #313136; color: #ddd; }.turn-meta { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 9px; color: #7d7d87; font-size: var(--text-small); opacity: 0; transition: opacity 150ms ease; }.assistant:hover .turn-meta,.turn-meta:focus-within { opacity: 1; }.turn-meta button { height: 25px; padding: 0 7px; border: 0; border-radius: 4px; background: transparent; color: #85858e; display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: var(--text-small); }.turn-meta button:hover { background: #303035; color: #ddd; }
  .reasoning,.plan { border: 0; border-radius: 6px; background: transparent; }.reasoning summary,.plan summary { min-height: 29px; padding: 0 4px; display: flex; align-items: center; gap: 7px; list-style: none; color: #81818a; cursor: pointer; }.reasoning summary span,.plan summary span { flex: 1; font-size: var(--text-caption); }.reasoning p,.plan > div { margin: 0; padding: 4px 8px 8px 23px; color: #7d7d86; font-size: var(--text-caption); line-height: var(--leading-body); white-space: pre-wrap; }.plan { border: 1px solid #3c3c42; background: #28282c; }.plan > div { border-top: 1px solid #38383e; color: #aaa; }.plan-actions { margin-top: 8px; display: flex; gap: 5px; }.plan-actions button { height: 26px; padding: 0 7px; border: 1px solid #484850; border-radius: 5px; background: #343439; color: #ddd; cursor: pointer; font-size: var(--text-micro); }.working { height: 28px; color: #888891; display: flex; align-items: center; gap: 7px; font-size: var(--text-small); }
  .turn-error { position: relative; padding: 10px 11px; border: 1px solid #633b3b; border-radius: 7px; background: #352525; }.turn-error > button:first-child { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border: 0; background: transparent; color: #b99090; }.turn-error strong { color: #f2c2c2; font-size: var(--text-small); }.turn-error p { margin: 4px 24px 8px 0; color: #b99090; font-size: var(--text-caption); }.turn-error .retry { height: 26px; border: 1px solid #714848; border-radius: 5px; background: #452e2e; color: #f1d0d0; display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: var(--text-caption); }
  .composer-wrap { position: relative; z-index: 50; flex: 0 0 auto; padding: 10px 12px 7px; border-top: 0; background: #222224; box-shadow: 0 -14px 28px #222224; overflow: visible; }.composer { position: relative; overflow: visible; border: 1px solid #3d3d42; border-radius: 17px; background: #1d1d1f; box-shadow: inset 0 1px #ffffff07, 0 8px 24px #0003; transition: border-color 120ms ease, box-shadow 120ms ease; }.composer:focus-within { border-color: #595960; box-shadow: inset 0 1px #ffffff0a, 0 8px 24px #0003, 0 0 0 1px #ffffff05; }.composer.disabled { opacity: .65; }.prompt-editor { position: relative; min-height: 78px; max-height: 180px; }.prompt-mirror { position: absolute; z-index: 1; inset: 0; overflow: hidden; pointer-events: none; }.prompt-mirror > div,.composer textarea { width: 100%; box-sizing: border-box; min-height: 78px; padding: 15px 14px 8px; font: var(--text-emphasis)/var(--leading-body) var(--font-ui); white-space: pre-wrap; overflow-wrap: break-word; }.prompt-mirror > div { color: #f1f1f3; }.composer textarea { position: relative; z-index: 2; max-height: 180px; resize: none; border: 0; outline: 0; background: transparent; color: transparent; caret-color: #f1f1f3; -webkit-text-fill-color: transparent; field-sizing: content; overflow-y: auto; }.composer textarea::placeholder { color: #72727a; -webkit-text-fill-color: #72727a; }.prompt-skill { border-radius: 4px; background: #294552; color: #aee5f7; box-shadow: inset 0 0 0 1px #3a6678; box-decoration-break: clone; -webkit-box-decoration-break: clone; }.mirror-caret-space { color: transparent; }.composer-controls { height: 42px; display: flex; align-items: center; padding: 0 8px 6px; gap: 2px; }.control-spacer { flex: 1; }.composer-controls > button { width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }.attach,.stash { background: transparent; color: #909098; }.attach:hover,.stash:hover { background: #2d2d31; color: #ededf0; }.composer-controls > button.stop { width: 30px; min-width: 30px; padding: 0; border: 1px solid #704149; border-radius: 50%; background: #3d272b; color: #ffc1c8; display: grid; place-items: center; }.composer-controls > button.stop:hover { border-color: #98525e; background: #502c33; color: #fff; }.send { background: #e7e7e9; color: #252528; box-shadow: 0 1px 2px #0005; }.send:not(:disabled):hover { background: #fff; }.composer-controls button:disabled { opacity: .35; cursor: default; }.send:disabled { opacity: 1; background: #3a3a3f; color: #777780; box-shadow: none; }.footer-meta { height: 21px; padding: 0 4px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #707078; font-size: var(--text-caption); }.footer-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.footer-meta kbd { flex: 0 0 auto; font: inherit; }
  .attachment-strip { display: flex; gap: 6px; padding: 8px 8px 0; overflow-x: auto; }.attachment-strip > div { width: 58px; height: 48px; position: relative; flex: 0 0 auto; overflow: hidden; border: 1px solid #45454c; border-radius: 6px; background: #252529; display: grid; place-items: center; }.attachment-strip img { width: 100%; height: 100%; object-fit: cover; }.attachment-strip span { position: absolute; inset: auto 2px 2px; overflow: hidden; padding: 2px; background: #171719c9; color: white; font-size: var(--text-micro); text-overflow: ellipsis; white-space: nowrap; }.attachment-strip button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: 0; border-radius: 4px; background: #18181bd9; color: white; display: grid; place-items: center; }
  .command-menu { position: absolute; z-index: 25; left: 7px; right: 7px; bottom: 100px; max-height: 220px; overflow-y: auto; padding: 5px; border: 1px solid #46464d; border-radius: 7px; background: #29292d; box-shadow: 0 12px 35px #000a; }.command-menu button { width: 100%; min-height: 42px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #eee; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; cursor: pointer; }.command-menu button.skill-row { min-height: 32px; justify-content: center; }.command-menu button:hover,.command-menu button.highlighted { background: #3a3a40; }.command-menu strong { font-size: var(--text-control); }.command-menu span { color: #83838c; font-size: var(--text-small); }
  .pending-card { margin-bottom: 8px; overflow: hidden; border: 1px solid #665331; border-radius: 8px; background: #302b22; }.pending-card header { min-height: 40px; padding: 0 8px 0 11px; display: flex; align-items: center; gap: 8px; }.pending-card header strong { flex: 1; font-size: var(--text-body); }.pending-card header span { color: #a99d86; font-size: var(--text-small); }.pending-card > p { margin: 0; padding: 0 11px 9px; color: #aea28e; font-size: var(--text-control); line-height: var(--leading-ui); }.pending-card > p.collapsed-question { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.collapse-pending { width: 26px; height: 26px; border: 0; border-radius: 4px; background: transparent; color: #a99d86; display: grid; place-items: center; }.collapse-pending :global(.rotated) { transform: rotate(180deg); }.pending-card pre { max-height: 140px; margin: 0; padding: 9px 11px; overflow: auto; border-top: 1px solid #51452f; background: #252118; color: #ddd2bb; font: var(--text-small)/var(--leading-body) var(--font-code); white-space: pre-wrap; }.pending-actions { padding: 8px; border-top: 1px solid #51452f; display: flex; justify-content: flex-end; gap: 5px; }.pending-actions button { min-height: 29px; padding: 0 9px; border: 1px solid #5a513e; border-radius: 5px; background: #3b3529; color: #d4cbb8; cursor: pointer; font-size: var(--text-small); }.pending-actions .approve { border-color: #9b6c27; background: #a96c1d; color: white; }.pending-actions .decline { color: #f1b6a9; }.answer-options { padding: 0 8px 8px; display: grid; gap: 4px; }.answer-options button { min-height: 42px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #e2dac9; display: flex; align-items: center; text-align: left; cursor: pointer; }.answer-options button:hover,.answer-options button.selected { background: #423927; }.answer-options button span { flex: 1; display: flex; flex-direction: column; gap: 2px; }.answer-options strong { font-size: var(--text-control); }.answer-options small { color: #998e7b; font-size: var(--text-small); }.answer-options kbd { color: #8f846f; font-family: var(--font-ui); font-size: var(--text-small); }.custom-answer { width: calc(100% - 18px); box-sizing: border-box; height: 33px; margin: 0 9px 9px; border: 1px solid #5b513d; border-radius: 5px; outline: 0; padding: 0 9px; background: #28241d; color: white; font-size: var(--text-control); }
  .pending-scopes { margin: 0; padding: 0 11px 9px 28px; color: #d8cdb8; font-size: var(--text-control); line-height: var(--leading-body); }.pending-scopes li + li { margin-top: 2px; }
  .banner,.sync-pill { min-height: 29px; margin-bottom: 6px; padding: 5px 7px; display: flex; align-items: center; gap: 6px; border: 1px solid #5e4930; border-radius: 6px; background: #332b20; color: #cbbd9f; font-size: var(--text-caption); }.banner.error { border-color: #633d3d; background: #372727; color: #d6aaaa; }.banner span { flex: 1; line-height: var(--leading-ui); }.banner button { width: 22px; height: 22px; border: 0; background: transparent; color: inherit; }.sync-pill { border-color: #414147; background: #2d2d31; color: #9999a2; }
  .history-panel { position: absolute; z-index: 35; inset: 50px 0 0; display: flex; flex-direction: column; background: #242426; }.history-title { height: 46px; padding: 0 13px; display: flex; align-items: center; justify-content: space-between; }.history-title strong { font-size: var(--text-emphasis); }.history-title button { height: 29px; padding: 0 9px; border: 1px solid #46464d; border-radius: 5px; background: #303034; color: #ddd; display: flex; align-items: center; gap: 5px; font-size: var(--text-small); }.history-search { height: 34px; margin: 0 10px 9px; padding: 0 10px; display: flex; align-items: center; gap: 7px; border: 1px solid #434349; border-radius: 6px; background: #2d2d31; color: #777780; }.history-search input { width: 100%; border: 0; outline: 0; background: transparent; color: white; font-size: var(--text-control); }.history-list { min-height: 0; flex: 1; overflow-y: auto; padding: 2px 7px 14px; }.history-row { position: relative; min-height: 53px; padding: 8px; border-radius: 6px; color: #dddde1; display: flex; align-items: center; gap: 8px; cursor: pointer; }.history-row:hover,.history-row.current { background: #333338; }.history-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }.history-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-control); }.history-copy small { color: #797982; font-size: var(--text-caption); }.status { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #55555d; }.status.working { background: #60a5fa; }.status.approval { background: #f59e0b; }.status.input { background: #a78bfa; }.status.failed { background: #f87171; }.unread { width: 6px; height: 6px; border-radius: 50%; background: #f4f4f5; }.row-menu { width: 27px; height: 27px; border: 0; border-radius: 4px; background: transparent; color: #8a8a93; opacity: 0; }.history-row:hover .row-menu { opacity: 1; }.thread-menu { position: absolute; z-index: 5; top: 42px; right: 4px; width: 132px; padding: 5px; border: 1px solid #46464d; border-radius: 6px; background: #29292d; box-shadow: 0 10px 28px #000b; }.thread-menu button { display: flex; align-items: center; gap: 6px; }.history-empty { padding: 30px 15px; text-align: center; color: #74747c; font-size: var(--text-control); }.jump-latest { position: absolute; z-index: 3; right: 17px; bottom: 147px; height: 29px; padding: 0 9px; border: 1px solid #4d4d54; border-radius: 15px; background: #343439; color: #ccc; display: flex; align-items: center; gap: 4px; box-shadow: 0 5px 15px #0006; cursor: pointer; font-size: var(--text-small); }
  .history-panel { inset: 42px 0 0; }
  :global(.spin) { transform-box: fill-box; transform-origin: center; will-change: transform; animation: codex-spin 750ms linear infinite; } @keyframes codex-spin { to { transform: rotate(360deg); } } @keyframes codex-pulse { 50% { opacity: .35; } } @media (prefers-reduced-motion: reduce) { :global(.spin) { animation: codex-pulse 1.1s ease-in-out infinite; } }
</style>
