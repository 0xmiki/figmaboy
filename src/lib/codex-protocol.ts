export type JsonObject = Record<string, unknown>;

export type CodexThreadStatus =
  | { type: "notLoaded" | "idle" | "systemError" }
  | { type: "active"; activeFlags?: string[] };

export type CodexThread = {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  cwd: string;
  isPinned?: boolean;
  status?: CodexThreadStatus;
  turns?: CodexTurn[];
};

export type CodexTurn = {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  items: CodexItem[];
  error?: { message?: string } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

export type CodexItem = JsonObject & {
  id: string;
  type: string;
  _turnId?: string;
};

export type CodexReasoningOption = {
  reasoningEffort: string;
  description?: string;
};

export type CodexServiceTier = {
  id: string;
  name: string;
  description?: string;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden?: boolean;
  upgrade?: string | null;
  upgradeInfo?: JsonObject | null;
  supportedReasoningEfforts: CodexReasoningOption[];
  defaultReasoningEffort: string;
  serviceTiers?: CodexServiceTier[];
  additionalSpeedTiers?: string[];
  defaultServiceTier?: string | null;
  inputModalities?: string[];
};

export type CodexSelection = {
  model: string;
  effort: string;
  serviceTier: string;
};

export type CodexUsage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  threadTotalTokens: number;
  modelContextWindow: number | null;
};

export type CodexTurnMeta = {
  id: string;
  status: CodexTurn["status"];
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  error: string;
};

export type CodexTimeline = {
  items: CodexItem[];
  activeTurnId: string | null;
  error: string;
  usage: CodexUsage | null;
  turns: Record<string, CodexTurnMeta>;
};

export type CodexEvent = {
  method?: string;
  id?: string | number;
  params?: JsonObject;
};

export type ToolGroup = {
  id: string;
  turnId: string | null;
  items: CodexItem[];
  status: "inProgress" | "completed" | "warning" | "failed" | "declined";
  summary: string;
};

export type CodexTimelineRow =
  | { kind: "item"; item: CodexItem }
  | { kind: "tools"; group: ToolGroup; label?: string };

export function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function emptyTimeline(): CodexTimeline {
  return { items: [], activeTurnId: null, error: "", usage: null, turns: {} };
}

export function itemId(value: unknown): string {
  const item = object(value);
  return typeof item.id === "string" ? item.id : "";
}

export function inputText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const value = object(part);
      if (value.type === "text" && typeof value.text === "string") return value.text;
      if (value.type === "localImage" || value.type === "image") return "[Image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function inputSkills(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return [...new Set(content
    .map((part) => object(part))
    .filter((part) => part.type === "skill" && typeof part.name === "string")
    .map((part) => String(part.name)))];
}

function userMessageSignature(item: CodexItem): string {
  if (!Array.isArray(item.content)) return "";
  const parts = item.content.map((part) => {
    const value = object(part);
    if (value.type === "text") return ["text", typeof value.text === "string" ? value.text : ""];
    if (value.type === "skill") return ["skill", typeof value.name === "string" ? value.name : ""];
    if (value.type === "localImage" || value.type === "image") return ["image", typeof value.path === "string" ? value.path : ""];
    return [String(value.type ?? "unknown")];
  });
  return JSON.stringify(parts);
}

export function itemText(item: CodexItem): string {
  if (item.type === "userMessage") return inputText(item.content);
  if (item.type === "agentMessage" || item.type === "plan") return typeof item.text === "string" ? item.text : "";
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.filter((value): value is string => typeof value === "string") : [];
    return summary.join("\n");
  }
  return "";
}

export function isToolItem(item: CodexItem): boolean {
  return ["mcpToolCall", "commandExecution", "fileChange", "dynamicToolCall", "webSearch", "imageView", "imageGeneration"].includes(item.type);
}

export function itemStatus(item: CodexItem): string {
  return typeof item.status === "string" ? item.status : "inProgress";
}

function upsert(items: CodexItem[], incoming: CodexItem): CodexItem[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index >= 0) {
    const previous = items[index];
    const merged = { ...previous, ...incoming, _turnId: incoming._turnId ?? previous?._turnId };
    return items.map((item, itemIndex) => itemIndex === index ? merged : item);
  }
  if (incoming.type === "userMessage") {
    const signature = userMessageSignature(incoming);
    const optimistic = items.findIndex((item) => item.type === "userMessage" && item.id.startsWith("local_") && userMessageSignature(item) === signature);
    if (optimistic >= 0) return items.map((item, itemIndex) => itemIndex === optimistic ? incoming : item);
  }
  return [...items, incoming];
}

function appendField(items: CodexItem[], id: string, field: string, delta: string): CodexItem[] {
  return items.map((item) => item.id === id
    ? { ...item, [field]: `${typeof item[field] === "string" ? item[field] : ""}${delta}` }
    : item);
}

function turnMeta(turn: Partial<CodexTurn> & { id: string }): CodexTurnMeta {
  return {
    id: turn.id,
    status: turn.status ?? "inProgress",
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    error: turn.error?.message ?? "",
  };
}

export function timelineFromThread(thread: CodexThread): CodexTimeline {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const metas = Object.fromEntries(turns.map((turn) => [turn.id, turnMeta(turn)]));
  return {
    items: turns.flatMap((turn) => Array.isArray(turn.items)
      ? turn.items.map((item) => ({ ...item, _turnId: turn.id }))
      : []),
    activeTurnId: turns.findLast((turn) => turn.status === "inProgress")?.id ?? null,
    error: turns.findLast((turn) => turn.status === "failed")?.error?.message ?? "",
    usage: null,
    turns: metas,
  };
}

export function reduceCodexEvent(
  timeline: CodexTimeline,
  event: CodexEvent,
  threadId: string | null,
): CodexTimeline {
  const params = object(event.params);
  if (threadId && typeof params.threadId === "string" && params.threadId !== threadId) return timeline;
  const method = event.method ?? "";
  const turnId = typeof params.turnId === "string" ? params.turnId : "";

  if (method === "turn/started") {
    const turn = object(params.turn) as Partial<CodexTurn> & { id?: string };
    const id = typeof turn.id === "string" ? turn.id : turnId;
    if (!id) return timeline;
    return {
      ...timeline,
      activeTurnId: id,
      error: "",
      turns: { ...timeline.turns, [id]: turnMeta({ ...turn, id, status: "inProgress" }) },
    };
  }
  if (method === "item/started" || method === "item/completed") {
    const item = { ...(object(params.item) as CodexItem), ...(turnId ? { _turnId: turnId } : {}) };
    if (!itemId(item) || typeof item.type !== "string") return timeline;
    return { ...timeline, items: upsert(timeline.items, item) };
  }
  if (method === "item/agentMessage/delta" || method === "item/plan/delta") {
    const id = typeof params.itemId === "string" ? params.itemId : "";
    const delta = typeof params.delta === "string" ? params.delta : "";
    const type = method === "item/plan/delta" ? "plan" : "agentMessage";
    let items = timeline.items;
    if (id && !items.some((item) => item.id === id)) items = [...items, { id, type, text: "", _turnId: turnId }];
    return { ...timeline, items: appendField(items, id, "text", delta) };
  }
  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    const id = typeof params.itemId === "string" ? params.itemId : "";
    const delta = typeof params.delta === "string" ? params.delta : "";
    const field = method.endsWith("summaryTextDelta") ? "summary" : "content";
    const existing = timeline.items.find((item) => item.id === id);
    if (!existing) {
      return { ...timeline, items: [...timeline.items, { id, type: "reasoning", summary: field === "summary" ? [delta] : [], content: field === "content" ? [delta] : [], _turnId: turnId }] };
    }
    return {
      ...timeline,
      items: timeline.items.map((item) => item.id === id
        ? { ...item, [field]: [`${Array.isArray(item[field]) ? item[field].join("") : ""}${delta}`] }
        : item),
    };
  }
  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
    const id = typeof params.itemId === "string" ? params.itemId : "";
    const delta = typeof params.delta === "string" ? params.delta : "";
    return { ...timeline, items: appendField(timeline.items, id, "aggregatedOutput", delta) };
  }
  if (method === "item/mcpToolCall/progress") {
    const id = typeof params.itemId === "string" ? params.itemId : "";
    const message = typeof params.message === "string" ? params.message : "";
    return { ...timeline, items: timeline.items.map((item) => item.id === id ? { ...item, progress: message } : item) };
  }
  if (method === "thread/tokenUsage/updated") {
    const tokenUsage = object(params.tokenUsage);
    const total = object(tokenUsage.total);
    const last = object(tokenUsage.last);
    const current = typeof last.totalTokens === "number" ? last : total;
    const usage: CodexUsage = {
      totalTokens: Number(current.totalTokens ?? 0),
      inputTokens: Number(current.inputTokens ?? 0),
      cachedInputTokens: Number(current.cachedInputTokens ?? 0),
      outputTokens: Number(current.outputTokens ?? 0),
      reasoningOutputTokens: Number(current.reasoningOutputTokens ?? 0),
      threadTotalTokens: Number(total.totalTokens ?? current.totalTokens ?? 0),
      modelContextWindow: typeof tokenUsage.modelContextWindow === "number" ? tokenUsage.modelContextWindow : null,
    };
    return { ...timeline, usage };
  }
  if (method === "error") {
    const error = object(params.error);
    return { ...timeline, error: typeof error.message === "string" ? error.message : "Codex failed" };
  }
  if (method === "turn/completed") {
    const turn = object(params.turn) as Partial<CodexTurn> & { id?: string };
    const id = typeof turn.id === "string" ? turn.id : turnId;
    const error = object(turn.error);
    return {
      ...timeline,
      activeTurnId: timeline.activeTurnId === id || !id ? null : timeline.activeTurnId,
      error: typeof error.message === "string" ? error.message : timeline.error,
      turns: id ? { ...timeline.turns, [id]: turnMeta({ ...turn, id }) } : timeline.turns,
    };
  }
  return timeline;
}

export function serviceTierOptions(model: CodexModel | undefined): CodexServiceTier[] {
  if (!model) return [];
  const tiers = model.serviceTiers?.length
    ? model.serviceTiers
    : (model.additionalSpeedTiers ?? []).map((id) => ({ id, name: id === "fast" ? "Fast" : titleCase(id) }));
  return [{ id: "default", name: "Standard" }, ...tiers.filter((tier) => tier.id !== "default")];
}

export function resolveCodexSelection(
  models: readonly CodexModel[],
  requested: Partial<CodexSelection> = {},
): CodexSelection {
  const model = models.find((candidate) => candidate.model === requested.model || candidate.id === requested.model)
    ?? models.find((candidate) => candidate.isDefault)
    ?? models[0];
  if (!model) return { model: "", effort: "", serviceTier: "default" };
  const efforts = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  const effort = requested.effort && efforts.includes(requested.effort)
    ? requested.effort
    : efforts.includes(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : efforts[0] ?? "";
  const tiers = serviceTierOptions(model);
  const requestedTier = requested.serviceTier || model.defaultServiceTier || "default";
  const serviceTier = tiers.some((tier) => tier.id === requestedTier) ? requestedTier : "default";
  return { model: model.model, effort, serviceTier };
}

export function reasoningLabel(value: string): string {
  const labels: Record<string, string> = {
    none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High",
    xhigh: "Extra High", max: "Max", ultra: "Ultra",
  };
  return labels[value] ?? titleCase(value);
}

export function titleCase(value: string): string {
  return value.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function toolAction(item: CodexItem): "inspect" | "change" | "capture" | "command" | "search" | "other" {
  if (item.type === "mcpToolCall") {
    const tool = String(item.tool ?? "");
    if (/screenshot|render/.test(tool)) return "capture";
    if (/apply|place|center|radius|undo|redo|save|select|viewport/.test(tool)) return "change";
    if (/get|list|status|capabilities|types/.test(tool)) return "inspect";
  }
  if (item.type === "fileChange") return "change";
  if (item.type === "commandExecution") return "command";
  if (item.type === "webSearch") return "search";
  return "other";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function summarizeToolItems(items: readonly CodexItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(toolAction(item), (counts.get(toolAction(item)) ?? 0) + 1);
  const labels: string[] = [];
  if (counts.get("inspect")) labels.push(`Inspected ${plural(counts.get("inspect")!, "design source")}`);
  if (counts.get("change")) labels.push(`Applied ${plural(counts.get("change")!, "design change")}`);
  if (counts.get("capture")) labels.push(`Captured ${plural(counts.get("capture")!, "preview")}`);
  if (counts.get("command")) labels.push(`Ran ${plural(counts.get("command")!, "command")}`);
  if (counts.get("search")) labels.push(`Searched ${plural(counts.get("search")!, "time")}`);
  if (counts.get("other")) labels.push(`Used ${plural(counts.get("other")!, "tool")}`);
  return labels.join(" · ") || "Agent activity";
}

export function groupToolItems(items: readonly CodexItem[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  let current: CodexItem[] = [];
  const flush = () => {
    if (!current.length) return;
    const statuses = current.map(itemStatus);
    const status: ToolGroup["status"] = statuses.includes("inProgress")
      ? "inProgress"
      : statuses.some((value) => value === "failed")
        ? "warning"
        : statuses.some((value) => value === "declined")
          ? "declined"
          : "completed";
    groups.push({
      id: `tools_${current[0]?.id}`,
      turnId: current[0]?._turnId ?? null,
      items: current,
      status,
      summary: summarizeToolItems(current),
    });
    current = [];
  };
  for (const item of items) {
    if (!isToolItem(item)) { flush(); continue; }
    if (current.length && current[0]?._turnId !== item._turnId) flush();
    current.push(item);
  }
  flush();
  return groups;
}

export function buildDisplayTimelineRows(value: CodexTimeline): CodexTimelineRow[] {
  const hiddenIds = new Set<string>();
  const foldsBefore = new Map<string, Extract<CodexTimelineRow, { kind: "tools" }>>();
  for (const turn of Object.values(value.turns).filter((candidate) => candidate.status !== "inProgress")) {
    const turnItems = value.items.filter((item) => item._turnId === turn.id);
    const agents = turnItems.filter((item) => item.type === "agentMessage");
    const terminalAgent = agents.at(-1);
    if (!terminalAgent) continue;
    const firstAgent = agents[0];
    const hidden = turnItems.filter((item) =>
      isToolItem(item) ||
      item.type === "reasoning" ||
      (item.type === "agentMessage" && item.id !== firstAgent?.id && item.id !== terminalAgent.id),
    );
    if (!hidden.length) continue;
    hidden.forEach((item) => hiddenIds.add(item.id));
    const tools = hidden.filter(isToolItem);
    foldsBefore.set(terminalAgent.id, {
      kind: "tools",
      label: turn.durationMs ? `Worked for ${formatDuration(turn.durationMs)}` : "Work details",
      group: {
        id: `turn-fold:${turn.id}`,
        turnId: turn.id,
        items: hidden,
        status: turn.status === "failed"
          ? "failed"
          : tools.some((item) => itemStatus(item) === "failed")
            ? "warning"
            : "completed",
        summary: tools.length ? summarizeToolItems(tools) : `${hidden.length} agent updates`,
      },
    });
  }

  const result: CodexTimelineRow[] = [];
  let toolBuffer: CodexItem[] = [];
  const flush = () => {
    if (!toolBuffer.length) return;
    result.push(...groupToolItems(toolBuffer).map((group) => ({ kind: "tools" as const, group })));
    toolBuffer = [];
  };
  for (const item of value.items) {
    const fold = foldsBefore.get(item.id);
    if (fold) { flush(); result.push(fold); }
    if (hiddenIds.has(item.id)) continue;
    if (isToolItem(item)) { toolBuffer.push(item); continue; }
    flush();
    result.push({ kind: "item", item });
  }
  flush();
  return result;
}

export function contextPercentage(usage: CodexUsage | null): number | null {
  if (!usage?.modelContextWindow || usage.modelContextWindow <= 0) return null;
  return Math.max(0, Math.min(100, usage.totalTokens / usage.modelContextWindow * 100));
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs < 1_000) return "<1s";
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function formatTokenCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview?.trim() || "Untitled chat";
}

export function uniqueEnabledSkills<T extends { name: string; enabled?: boolean }>(skills: readonly T[]): T[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const name = skill.name.trim();
    if (!name || skill.enabled === false || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export function threadAttention(thread: CodexThread, pendingApproval = false, pendingInput = false): "approval" | "input" | "working" | "failed" | "ready" {
  if (pendingApproval) return "approval";
  if (pendingInput) return "input";
  if (thread.status?.type === "active") {
    if (thread.status.activeFlags?.some((flag) => /approval/i.test(flag))) return "approval";
    if (thread.status.activeFlags?.some((flag) => /input/i.test(flag))) return "input";
    return "working";
  }
  if (thread.status?.type === "systemError") return "failed";
  return "ready";
}
