import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import { EvolveCandidateStore, evolveCandidateConflicts } from "$lib/editor/evolve-candidates";

function document() {
  const value = emptyDocument();
  const frame = defaultNode("frame", 0, 0, { id: "frame", width: 800, height: 600 });
  const card = defaultNode("rectangle", 40, 40, { id: "card", parentId: frame.id, radius: 8 });
  if (frame.type !== "frame") throw new Error("Expected a frame fixture");
  frame.childIds = [card.id];
  value.rootIds = [frame.id];
  value.nodes = { [frame.id]: frame, [card.id]: card };
  return value;
}

describe("isolated evolve candidates", () => {
  it("rebases a candidate when the user changed another property", () => {
    const base = document();
    const store = new EvolveCandidateStore();
    store.start({ runId: "run", fileId: "file", pageId: "page", pageEpoch: 1, frameId: "frame", contentRevision: 4, document: base });
    store.materialize("run", "A", [{ kind: "update", id: "card", patch: { radius: 24 } }]);
    const current = structuredClone(base);
    current.nodes.card.x = 120;
    const rebased = store.rebase("run", "A", current, 5);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.candidate.document.nodes.card).toMatchObject({ x: 120, radius: 24 });
  });

  it("reports an exact property conflict", () => {
    const base = document();
    const current = structuredClone(base);
    current.nodes.card.radius = 16;
    expect(evolveCandidateConflicts(base, current, [{ kind: "update", id: "card", patch: { radius: 24 } }])).toEqual([
      "card.radius changed from 8 to 16; candidate requested 24",
    ]);
  });

  it("ignores viewport movement", () => {
    const base = document();
    const current = structuredClone(base);
    current.viewport = { x: 400, y: -200, zoom: 1.8 };
    expect(evolveCandidateConflicts(base, current, [{ kind: "update", id: "card", patch: { radius: 24 } }])).toEqual([]);
  });

  it("drops losing-generation documents when the run base restarts", () => {
    const base = document();
    const store = new EvolveCandidateStore();
    const args = { runId: "run", fileId: "file", pageId: "page", pageEpoch: 1, frameId: "frame", contentRevision: 4, document: base };
    store.start(args);
    store.materialize("run", "A", [{ kind: "update", id: "card", patch: { radius: 24 } }]);
    store.start(args);
    expect(() => store.candidate("run", "A")).toThrow("EVOLVE_CANDIDATE_MISSING");
  });

  it("detects a user edit before an agent deletion", () => {
    const base = document();
    const current = structuredClone(base);
    current.nodes.card.x = 200;
    expect(evolveCandidateConflicts(base, current, [{ kind: "delete", ids: ["card"] }])).toEqual(["layer card changed before candidate deletion"]);
  });
});
