import type { PageDocument } from "$lib/domain";
import { cloneDocument } from "$lib/domain";
import { materializeOperations, validateEvolutionOperationsForDocument } from "$lib/editor/editor-rpc";

type JsonObject = Record<string, unknown>;

export type EvolveCandidate = {
  runId: string;
  candidateId: string;
  frameId: string;
  baseContentRevision: number;
  renderedContentRevision: number;
  operations: unknown[];
  document: PageDocument;
  createdIds: string[];
};

type EvolveRun = {
  runId: string;
  fileId: string;
  pageId: string;
  pageEpoch: number;
  frameId: string;
  baseContentRevision: number;
  baseDocument: PageDocument;
  candidates: Map<string, EvolveCandidate>;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function childIds(document: PageDocument, parentId: string | null): string[] | null {
  if (!parentId) return document.rootIds;
  const parent = document.nodes[parentId];
  return parent?.type === "frame" || parent?.type === "group" ? parent.childIds : null;
}

/** Exact conflicts between a candidate operation and committed edits since its base revision. */
export function evolveCandidateConflicts(base: PageDocument, current: PageDocument, operations: unknown[]): string[] {
  const created = new Set<string>();
  const conflicts: string[] = [];
  for (const value of operations) {
    const operation = object(value);
    if (operation.kind === "create") {
      const node = object(operation.node);
      const id = typeof node.id === "string" ? node.id : "";
      const parentId = typeof operation.parentId === "string" ? operation.parentId : null;
      if (id) {
        if (current.nodes[id]) conflicts.push(`created layer ${id} now exists`);
        created.add(id);
      }
      if (parentId && !created.has(parentId) && !current.nodes[parentId]) conflicts.push(`parent ${parentId} no longer exists`);
      if (typeof operation.index === "number" && !created.has(parentId ?? "")) {
        const before = childIds(base, parentId);
        const now = childIds(current, parentId);
        if (!before || !now || !sameValue(before, now)) conflicts.push(`children of ${parentId ?? "the page"} changed before indexed insertion`);
      }
      continue;
    }
    if (operation.kind === "update") {
      const id = typeof operation.id === "string" ? operation.id : "";
      if (!id || created.has(id)) continue;
      const before = base.nodes[id] as unknown as JsonObject | undefined;
      const now = current.nodes[id] as unknown as JsonObject | undefined;
      if (!before || !now) { conflicts.push(`layer ${id} no longer matches the candidate base`); continue; }
      for (const [property, candidateValue] of Object.entries(object(operation.patch))) {
        if (!sameValue(before[property], now[property])) conflicts.push(`${id}.${property} changed from ${JSON.stringify(before[property])} to ${JSON.stringify(now[property])}; candidate requested ${JSON.stringify(candidateValue)}`);
      }
      continue;
    }
    if (operation.kind === "delete") {
      const ids = Array.isArray(operation.ids) ? operation.ids.filter((id): id is string => typeof id === "string") : [];
      for (const id of ids) if (!sameValue(base.nodes[id], current.nodes[id])) conflicts.push(`layer ${id} changed before candidate deletion`);
      continue;
    }
    if (operation.kind === "reparent") {
      const ids = Array.isArray(operation.ids) ? operation.ids.filter((id): id is string => typeof id === "string") : [];
      for (const id of ids) if (base.nodes[id]?.parentId !== current.nodes[id]?.parentId) conflicts.push(`layer ${id} was reparented after the candidate base`);
      const parentId = typeof operation.parentId === "string" ? operation.parentId : null;
      const before = childIds(base, parentId);
      const now = childIds(current, parentId);
      if (!before || !now || !sameValue(before, now)) conflicts.push(`children of ${parentId ?? "the page"} changed before reparent`);
      continue;
    }
    if (operation.kind === "reorder") {
      const parentId = typeof operation.parentId === "string" ? operation.parentId : null;
      if (created.has(parentId ?? "")) continue;
      const before = childIds(base, parentId);
      const now = childIds(current, parentId);
      if (!before || !now || !sameValue(before, now)) conflicts.push(`children of ${parentId ?? "the page"} changed before reorder`);
    }
  }
  return [...new Set(conflicts)];
}

export class EvolveCandidateStore {
  private readonly runs = new Map<string, EvolveRun>();

  start(args: { runId: string; fileId: string; pageId: string; pageEpoch: number; frameId: string; contentRevision: number; document: PageDocument }): EvolveRun {
    const frame = args.document.nodes[args.frameId];
    if (frame?.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the evolution target is no longer available");
    const run: EvolveRun = {
      runId: args.runId,
      fileId: args.fileId,
      pageId: args.pageId,
      pageEpoch: args.pageEpoch,
      frameId: args.frameId,
      baseContentRevision: args.contentRevision,
      baseDocument: cloneDocument(args.document),
      candidates: new Map(),
    };
    this.runs.set(args.runId, run);
    return run;
  }

  run(runId: string): EvolveRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("EVOLVE_RUN_MISSING: restart the evolution run");
    return run;
  }

  materialize(runId: string, candidateId: string, operations: unknown[]): EvolveCandidate {
    const run = this.run(runId);
    validateEvolutionOperationsForDocument(run.baseDocument, run.frameId, operations);
    const result = materializeOperations(run.baseDocument, operations);
    const candidate: EvolveCandidate = {
      runId,
      candidateId,
      frameId: run.frameId,
      baseContentRevision: run.baseContentRevision,
      renderedContentRevision: run.baseContentRevision,
      operations: structuredClone(operations),
      document: result.candidate,
      createdIds: result.createdIds,
    };
    run.candidates.set(candidateId, candidate);
    return candidate;
  }

  candidate(runId: string, candidateId: string): EvolveCandidate {
    const candidate = this.run(runId).candidates.get(candidateId);
    if (!candidate) throw new Error("EVOLVE_CANDIDATE_MISSING: regenerate this candidate");
    return candidate;
  }

  rebase(runId: string, candidateId: string, current: PageDocument, contentRevision: number): { candidate: EvolveCandidate; conflicts: string[] } {
    const run = this.run(runId);
    const candidate = this.candidate(runId, candidateId);
    const conflicts = evolveCandidateConflicts(run.baseDocument, current, candidate.operations);
    if (conflicts.length) return { candidate, conflicts };
    validateEvolutionOperationsForDocument(current, run.frameId, candidate.operations);
    const result = materializeOperations(current, candidate.operations);
    candidate.document = result.candidate;
    candidate.createdIds = result.createdIds;
    candidate.renderedContentRevision = contentRevision;
    return { candidate, conflicts: [] };
  }

  discard(runId: string): void {
    this.runs.delete(runId);
  }

  clear(): void {
    this.runs.clear();
  }
}
