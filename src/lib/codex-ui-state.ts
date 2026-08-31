import type { CodexModel, CodexSelection, JsonObject } from "$lib/codex-protocol";

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
  action?: "new" | "review" | "save" | "compact" | "undo" | "install-mcp";
};

export const COMPOSER_COMMANDS: ComposerCommand[] = [
  { id: "/new", label: "/new", description: "Start a new chat", action: "new" },
  { id: "/review", label: "/review", description: "Review the current design", action: "review" },
  { id: "/save", label: "/save", description: "Save the open design", action: "save" },
  { id: "/compact", label: "/compact", description: "Compact this chat context", action: "compact" },
  { id: "/undo", label: "/undo", description: "Undo the last Figmaboy change", action: "undo" },
  { id: "/install-mcp", label: "/install-mcp", description: "Connect external Codex clients", action: "install-mcp" },
];

export const CONTEXT_MENTIONS = [
  { id: "@selection", label: "@selection", description: "The selected layers" },
  { id: "@current-frame", label: "@current-frame", description: "The selected or containing frame" },
  { id: "@page", label: "@page", description: "The open page" },
  { id: "@design", label: "@design", description: "The complete open design" },
];

export function composerTrigger(value: string): { kind: "command" | "mention" | "skill"; query: string; start: number } | null {
  const match = /(^|\s)([/@$])([^\s]*)$/.exec(value);
  if (!match) return null;
  return {
    kind: match[2] === "/" ? "command" : match[2] === "@" ? "mention" : "skill",
    query: match[3]?.toLowerCase() ?? "",
    start: match.index + match[1]!.length,
  };
}

export function replaceComposerTrigger(value: string, start: number, replacement: string): string {
  return `${value.slice(0, start)}${replacement} `;
}
