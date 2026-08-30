import { beforeEach, describe, expect, it, vi } from "vitest";
import { repository } from "$lib/repository";
import { EXTENSIONS_CHANGED_EVENT, stageExtensionManifest } from "$lib/extensions/staging";

function aiManifest() {
  return {
    format: "figmaboy-extension",
    apiVersion: 1,
    id: "codex.round-selection",
    name: "Round selection",
    version: "1.0.0",
    permissions: ["ui.sidebar", "design.write"],
    contributes: { sidebar: [{
      id: "rounding",
      title: "Round selection",
      controls: [
        { type: "number", id: "radius", label: "Radius", default: 16, min: 0 },
        { type: "button", id: "apply", label: "Apply radius", requiresSelection: true, action: {
          type: "design.transact", label: "Round selected layers",
          operations: [{ kind: "update", target: "selection", patch: { radius: { $control: "radius" } } }],
        } },
      ],
    }] },
  };
}

describe("AI extension staging", () => {
  beforeEach(() => localStorage.clear());

  it("turns a validated manifest into one inert trial and announces it", async () => {
    const changed = vi.fn();
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, changed);
    const result = await stageExtensionManifest(repository(), aiManifest());
    expect(result).toMatchObject({ status: "trial", extensionId: "codex.round-selection", panels: 1, controls: 2, actions: 1, operationKinds: ["update"], userDecisionRequired: true, canvasActionsRun: false });
    expect(result.previewHash).toHaveLength(64);
    const installed = await repository().extensionsList();
    expect(installed[0]).toMatchObject({ activeHash: null, previewHash: result.previewHash, preview: { name: "Round selection" } });
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener(EXTENSIONS_CHANGED_EVENT, changed);
  });

  it("creates no trial when validation fails", async () => {
    const invalid = aiManifest();
    invalid.permissions = ["ui.sidebar"];
    await expect(stageExtensionManifest(repository(), invalid)).rejects.toThrow("design.write");
    expect(await repository().extensionsList()).toEqual([]);
  });

  it("deduplicates a retried identical manifest", async () => {
    const first = await stageExtensionManifest(repository(), aiManifest());
    const second = await stageExtensionManifest(repository(), aiManifest());
    expect(second.previewHash).toBe(first.previewHash);
    expect((await repository().extensionsList())[0].versions).toHaveLength(1);
  });

  it("does not replace a different trial without the user deciding", async () => {
    await stageExtensionManifest(repository(), aiManifest());
    const revision = aiManifest();
    revision.version = "1.1.0";
    await expect(stageExtensionManifest(repository(), revision)).rejects.toThrow("TRIAL_ALREADY_PENDING");
    expect((await repository().extensionsList())[0].preview?.version).toBe("1.0.0");
  });

  it("rejects oversized tool payloads before persistence", async () => {
    const oversized = aiManifest();
    oversized.name = "x".repeat(300_000);
    await expect(stageExtensionManifest(repository(), oversized)).rejects.toThrow("MANIFEST_TOO_LARGE");
    expect(await repository().extensionsList()).toEqual([]);
  });
});
