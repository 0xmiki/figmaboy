import { describe, expect, it } from "vitest";
import { parseExtensionManifest } from "$lib/extensions/manifest";

function manifest() {
  return {
    format: "figmaboy-extension",
    apiVersion: 1,
    id: "local.selection-tools",
    name: "Selection tools",
    version: "1.0.0",
    permissions: ["ui.sidebar", "design.read", "design.write"],
    contributes: {
      sidebar: [{
        id: "style",
        title: "Style selection",
        controls: [
          { type: "number", id: "radius", label: "Radius", default: 16 },
          { type: "button", id: "apply", label: "Apply", requiresSelection: true, action: {
            type: "design.transact", label: "Round selection", operations: [{ kind: "update", target: "selection", patch: { radius: { $control: "radius" } } }],
          } },
        ],
      }],
    },
  };
}

describe("extension manifests", () => {
  it("accepts native sidebar controls and canvas transactions", () => {
    expect(parseExtensionManifest(manifest())).toMatchObject({ id: "local.selection-tools", apiVersion: 1 });
  });

  it("requires canvas write permission for action buttons", () => {
    const value = manifest();
    value.permissions = ["ui.sidebar", "design.read"];
    expect(() => parseExtensionManifest(value)).toThrow("design.write");
  });

  it("rejects duplicate control IDs", () => {
    const value = manifest();
    value.contributes.sidebar[0].controls.unshift({ type: "number", id: "radius", label: "Another radius", default: 4 } as never);
    expect(() => parseExtensionManifest(value)).toThrow("used more than once");
  });
});
