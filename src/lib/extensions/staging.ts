import type { Repository } from "$lib/repository";
import { parseExtensionManifest } from "$lib/extensions/manifest";
import type { ExtensionControl } from "$lib/extensions/types";

export const EXTENSIONS_CHANGED_EVENT = "figmaboy-extensions-changed";
const MAX_STAGED_MANIFEST_BYTES = 256 * 1024;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function visitControls(controls: ExtensionControl[], summary: { controls: number; actions: number; operationKinds: Set<string> }): void {
  for (const control of controls) {
    summary.controls += 1;
    if (control.type === "row") visitControls(control.controls, summary);
    if (control.type === "button") {
      summary.actions += 1;
      control.action.operations.forEach((operation) => summary.operationKinds.add(operation.kind));
    }
  }
}

export async function stageExtensionManifest(repo: Pick<Repository, "extensionStage" | "extensionsList">, value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > MAX_STAGED_MANIFEST_BYTES) throw new Error("MANIFEST_TOO_LARGE: extension trials must be smaller than 256 KB");
  const manifest = parseExtensionManifest(value);
  const existing = (await repo.extensionsList()).find((extension) => extension.id === manifest.id);
  if (existing?.preview && canonicalJson(existing.preview) !== canonicalJson(manifest)) {
    throw new Error(`TRIAL_ALREADY_PENDING: ${manifest.id} already has a different trial. The user must Keep or Discard it before Codex stages another version.`);
  }
  const staged = existing?.preview ? existing : await repo.extensionStage(manifest);
  if (!staged.previewHash) throw new Error("The extension trial was not created");
  const summary = { controls: 0, actions: 0, operationKinds: new Set<string>() };
  manifest.contributes.sidebar.forEach((panel) => visitControls(panel.controls, summary));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT));
  return {
    status: "trial" as const,
    extensionId: staged.id,
    name: manifest.name,
    version: manifest.version,
    previewHash: staged.previewHash,
    panels: manifest.contributes.sidebar.length,
    controls: summary.controls,
    actions: summary.actions,
    operationKinds: [...summary.operationKinds].sort(),
    userDecisionRequired: true,
    canvasActionsRun: false,
  };
}
