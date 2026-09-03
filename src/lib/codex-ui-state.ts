import type { CodexItem, CodexModel, CodexSelection, CodexThread, CodexTimeline, CodexTurnMeta, JsonObject } from "$lib/codex-protocol";

export type CodexApprovalMode = "ask" | "auto";

export type CodexAttachment = {
  id: string;
  name: string;
  mime: string;
  path: string;
  previewUrl?: string;
};

export type CodexSkillReference = {
  name: string;
  path: string;
};

export type CodexDraft = {
  prompt: string;
  selection?: Partial<CodexSelection>;
  selectionExplicit?: boolean;
  attachments: CodexAttachment[];
  skills: CodexSkillReference[];
};

export type CodexLocalThread = {
  thread: CodexThread;
  timeline: CodexTimeline;
  archived?: boolean;
};

export type CodexUiState = {
  version: 1;
  drafts: Record<string, CodexDraft>;
  cachedModels: CodexModel[];
  promptStash: string[];
  pinnedThreadIds: string[];
  approvalMode: CodexApprovalMode;
  lastThreadId: string | null;
  lastThreadIdByPage: Record<string, string | null>;
  lastVisitedAt: Record<string, number>;
  localThreads: Record<string, CodexLocalThread>;
};

export const NEW_CHAT_DRAFT = "__new__";

export function emptyCodexUiState(): CodexUiState {
  return {
    version: 1,
    drafts: {},
    cachedModels: [],
    promptStash: [],
    pinnedThreadIds: [],
    approvalMode: "ask",
    lastThreadId: null,
    lastThreadIdByPage: {},
    lastVisitedAt: {},
    localThreads: {},
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function attachment(value: unknown): CodexAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JsonObject;
  if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.mime !== "string" || typeof item.path !== "string") return null;
  return { id: item.id, name: item.name, mime: item.mime, path: item.path };
}

function skill(value: unknown): CodexSkillReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JsonObject;
  if (typeof item.name !== "string" || typeof item.path !== "string") return null;
  return { name: item.name, path: item.path };
}

function localThread(value: unknown): CodexLocalThread | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonObject;
  const rawThread = record.thread;
  const rawTimeline = record.timeline;
  if (!rawThread || typeof rawThread !== "object" || Array.isArray(rawThread)) return null;
  if (!rawTimeline || typeof rawTimeline !== "object" || Array.isArray(rawTimeline)) return null;
  const thread = rawThread as JsonObject;
  const threadId = typeof thread.id === "string" ? thread.id : "";
  if (!threadId) return null;
  const timeline = rawTimeline as JsonObject;
  const items = Array.isArray(timeline.items)
    ? timeline.items.filter((item): item is CodexItem => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as JsonObject).id === "string" && typeof (item as JsonObject).type === "string"))
    : [];
  const turns: Record<string, CodexTurnMeta> = {};
  if (timeline.turns && typeof timeline.turns === "object" && !Array.isArray(timeline.turns)) {
    for (const [id, value] of Object.entries(timeline.turns as JsonObject)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const turn = value as JsonObject;
      const status = turn.status === "failed" || turn.status === "interrupted" || turn.status === "inProgress" ? turn.status : "completed";
      turns[id] = {
        id,
        status: status === "inProgress" ? "interrupted" : status,
        startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
        completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
        durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null,
        error: typeof turn.error === "string" ? turn.error : "",
      };
    }
  }
  return {
    thread: {
      id: threadId,
      preview: typeof thread.preview === "string" ? thread.preview : "",
      name: typeof thread.name === "string" ? thread.name : null,
      createdAt: typeof thread.createdAt === "number" ? thread.createdAt : 0,
      updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
      recencyAt: typeof thread.recencyAt === "number" ? thread.recencyAt : null,
      cwd: typeof thread.cwd === "string" ? thread.cwd : "",
      isPinned: thread.isPinned === true,
      status: { type: "notLoaded" },
    },
    timeline: {
      items,
      activeTurnId: null,
      error: typeof timeline.error === "string" ? timeline.error : "",
      usage: null,
      turns,
    },
    archived: record.archived === true,
  };
}

export function parseCodexUiState(value: unknown): CodexUiState {
  const empty = emptyCodexUiState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const root = value as JsonObject;
  const drafts: Record<string, CodexDraft> = {};
  if (root.drafts && typeof root.drafts === "object" && !Array.isArray(root.drafts)) {
    for (const [key, draftValue] of Object.entries(root.drafts as JsonObject)) {
      if (!draftValue || typeof draftValue !== "object" || Array.isArray(draftValue)) continue;
      const draft = draftValue as JsonObject;
      const selection = draft.selection && typeof draft.selection === "object" && !Array.isArray(draft.selection)
        ? draft.selection as Partial<CodexSelection>
        : undefined;
      drafts[key] = {
        prompt: typeof draft.prompt === "string" ? draft.prompt : "",
        ...(selection ? { selection } : {}),
        ...(draft.selectionExplicit === true ? { selectionExplicit: true } : {}),
        attachments: Array.isArray(draft.attachments) ? draft.attachments.map(attachment).filter((item): item is CodexAttachment => item !== null) : [],
        skills: Array.isArray(draft.skills) ? draft.skills.map(skill).filter((item): item is CodexSkillReference => item !== null) : [],
      };
    }
  }
  const lastVisitedAt: Record<string, number> = {};
  if (root.lastVisitedAt && typeof root.lastVisitedAt === "object" && !Array.isArray(root.lastVisitedAt)) {
    for (const [key, timestamp] of Object.entries(root.lastVisitedAt as JsonObject)) {
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) lastVisitedAt[key] = timestamp;
    }
  }
  const lastThreadIdByPage: Record<string, string | null> = {};
  if (root.lastThreadIdByPage && typeof root.lastThreadIdByPage === "object" && !Array.isArray(root.lastThreadIdByPage)) {
    for (const [pageId, threadId] of Object.entries(root.lastThreadIdByPage as JsonObject)) {
      if (typeof threadId === "string" || threadId === null) lastThreadIdByPage[pageId] = threadId;
    }
  }
  const localThreads: Record<string, CodexLocalThread> = {};
  if (root.localThreads && typeof root.localThreads === "object" && !Array.isArray(root.localThreads)) {
    for (const value of Object.values(root.localThreads as JsonObject)) {
      const parsed = localThread(value);
      if (parsed) localThreads[parsed.thread.id] = parsed;
    }
  }
  return {
    version: 1,
    drafts,
    cachedModels: Array.isArray(root.cachedModels) ? root.cachedModels.filter((model): model is CodexModel => Boolean(model && typeof model === "object" && !Array.isArray(model) && typeof (model as JsonObject).model === "string")) : [],
    promptStash: strings(root.promptStash).slice(0, 20),
    pinnedThreadIds: [...new Set(strings(root.pinnedThreadIds))],
    approvalMode: root.approvalMode === "auto" ? "auto" : "ask",
    lastThreadId: typeof root.lastThreadId === "string" ? root.lastThreadId : null,
    lastThreadIdByPage,
    lastVisitedAt,
    localThreads,
  };
}

export function draftKey(threadId: string | null): string {
  return threadId ?? NEW_CHAT_DRAFT;
}

export type ComposerCommand = {
  id: string;
  label: string;
  description: string;
  prompt?: string;
  action?: "new" | "review" | "evolve" | "save" | "compact" | "undo";
};

export const COMPOSER_COMMANDS: ComposerCommand[] = [
  { id: "/new", label: "/new", description: "Start a new chat", action: "new" },
  { id: "/review", label: "/review", description: "Review the current design", action: "review" },
  { id: "/evolve", label: "/evolve", description: "Reconstruct a selected frame beside its reference", action: "evolve" },
  { id: "/save", label: "/save", description: "Save the open design", action: "save" },
  { id: "/compact", label: "/compact", description: "Compact this chat context", action: "compact" },
  { id: "/undo", label: "/undo", description: "Undo the last Figmaboy change", action: "undo" },
];

export function evolveDirection(value: string): string | null {
  const match = /^\/evolve(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? (match[1] ?? "").trim() : null;
}

export const CONTEXT_MENTIONS = [
  { id: "@selection", label: "@selection", description: "The selected layers" },
  { id: "@current-frame", label: "@current-frame", description: "The selected or containing frame" },
  { id: "@page", label: "@page", description: "The open page" },
  { id: "@design", label: "@design", description: "The complete open design" },
];

export function composerTrigger(value: string, caret = value.length): { kind: "command" | "mention" | "skill"; query: string; start: number; end: number } | null {
  const beforeCaret = value.slice(0, Math.max(0, Math.min(value.length, caret)));
  const match = /(^|\s)([/@$])([^\s]*)$/.exec(beforeCaret);
  if (!match) return null;
  return {
    kind: match[2] === "/" ? "command" : match[2] === "@" ? "mention" : "skill",
    query: match[3]?.toLowerCase() ?? "",
    start: match.index + match[1]!.length,
    end: beforeCaret.length,
  };
}

export function replaceComposerTrigger(value: string, start: number, replacement: string, end = value.length): string {
  const suffix = value.slice(end);
  return `${value.slice(0, start)}${replacement}${suffix.startsWith(" ") ? "" : " "}${suffix}`;
}
