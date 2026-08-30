import { DesignService } from "$lib/editor/design-service";
import type {
  ExtensionControl,
  ExtensionDesignAction,
  ExtensionDesignOperation,
  ExtensionManifest,
  ExtensionTransactionResult,
} from "$lib/extensions/types";

export type ExtensionControlState = Record<string, string | number | boolean>;

export function initialControlState(controls: ExtensionControl[]): ExtensionControlState {
  const state: ExtensionControlState = {};
  const visit = (items: ExtensionControl[]) => items.forEach((control) => {
    if (control.type === "row") return visit(control.controls);
    if (control.type === "number") state[control.id] = control.default ?? 0;
    else if (control.type === "input") state[control.id] = control.default ?? "";
    else if (control.type === "select") state[control.id] = control.default ?? control.options[0]?.value ?? "";
    else if (control.type === "checkbox") state[control.id] = control.default ?? false;
  });
  visit(controls);
  return state;
}

function resolveValue(value: unknown, controls: ExtensionControlState): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, controls));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length === 1 && typeof source.$control === "string") {
    if (!(source.$control in controls)) throw new Error(`Unknown control value ${source.$control}`);
    return controls[source.$control];
  }
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, resolveValue(item, controls)]));
}

export function materializeExtensionOperations(
  operations: ExtensionDesignOperation[],
  controls: ExtensionControlState,
  selectedIds: string[],
): ExtensionDesignOperation[] {
  return operations.flatMap((operation) => {
    if (operation.kind === "create") {
      return [{ ...operation, node: resolveValue(operation.node, controls) as Record<string, unknown> } as ExtensionDesignOperation];
    }
    if (operation.kind === "update") {
      const patch = resolveValue(operation.patch, controls) as Record<string, unknown>;
      if (operation.target === "selection") {
        if (!selectedIds.length) throw new Error("Select at least one layer first");
        return selectedIds.map((id) => ({ kind: "update", id, patch } as ExtensionDesignOperation));
      }
      if (!operation.id) throw new Error("An update operation needs id or target: selection");
      return [{ kind: "update", id: operation.id, patch } as ExtensionDesignOperation];
    }
    if (operation.kind === "delete") {
      const ids = operation.target === "selection" ? selectedIds : operation.ids;
      if (!ids?.length) throw new Error("A delete operation needs layer IDs or target: selection");
      return [{ kind: "delete", ids: [...ids] } as ExtensionDesignOperation];
    }
    if (operation.kind === "reparent") {
      const ids = operation.target === "selection" ? selectedIds : operation.ids;
      if (!ids?.length) throw new Error("A reparent operation needs layer IDs or target: selection");
      return [{ kind: "reparent", ids: [...ids], parentId: operation.parentId, index: operation.index } as ExtensionDesignOperation];
    }
    return [resolveValue(operation, controls) as ExtensionDesignOperation];
  });
}

export function runExtensionAction(
  service: DesignService,
  manifest: ExtensionManifest,
  action: ExtensionDesignAction,
  controls: ExtensionControlState,
): ExtensionTransactionResult {
  if (!manifest.permissions.includes("design.write")) throw new Error(`${manifest.name} does not have canvas write access`);
  const context = service.context();
  const operations = materializeExtensionOperations(action.operations, controls, context.selectedIds);
  const transaction = {
    label: action.label,
    source: { kind: "extension" as const, id: manifest.id, version: manifest.version },
    expectedChangeToken: context.changeToken,
    operations,
    selectCreated: action.selectCreated,
  };
  return service.transact(transaction);
}
