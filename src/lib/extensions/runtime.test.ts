import { describe, expect, it } from "vitest";
import { materializeExtensionOperations } from "$lib/extensions/runtime";

describe("extension canvas actions", () => {
  it("expands selection targets and typed control references", () => {
    const operations = materializeExtensionOperations([
      { kind: "update", target: "selection", patch: { radius: { $control: "radius" }, name: { $control: "name" } } },
    ], { radius: 24, name: "Card" }, ["one", "two"]);
    expect(operations).toEqual([
      { kind: "update", id: "one", patch: { radius: 24, name: "Card" } },
      { kind: "update", id: "two", patch: { radius: 24, name: "Card" } },
    ]);
  });

  it("does not run selection actions without a selection", () => {
    expect(() => materializeExtensionOperations([
      { kind: "delete", target: "selection" },
    ], {}, [])).toThrow("layer IDs");
  });
});
