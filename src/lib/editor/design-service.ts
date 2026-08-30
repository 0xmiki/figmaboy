import type { DesignNode, PageDocument } from "$lib/domain";
import { cloneDocument } from "$lib/domain";
import type { EditorSession } from "$lib/editor/editor.svelte";
import { applyExternalOperations, prepareExternalOperations } from "$lib/editor/editor-rpc";
import type { ExtensionDesignOperation, ExtensionTransactionResult } from "$lib/extensions/types";

export interface DesignTransaction {
  label: string;
  source: { kind: "extension" | "codex" | "core"; id: string; version?: string };
  expectedChangeToken?: number;
  operations: ExtensionDesignOperation[];
  selectCreated?: boolean;
}

/** One document authority for core tools, Codex, and extensions. */
export class DesignService {
  constructor(private readonly session: EditorSession) {}

  private checkExtensionLocks(transaction: DesignTransaction): void {
    if (transaction.source.kind !== "extension") return;
    for (const operation of transaction.operations) {
      const ids = operation.kind === "update" ? [operation.id]
        : operation.kind === "delete" || operation.kind === "reparent" ? operation.ids
        : [];
      for (const id of ids ?? []) {
        if (id && this.session.document.nodes[id]?.locked) throw new Error(`Layer ${id} is locked`);
      }
    }
  }

  snapshot(): { document: PageDocument; changeToken: number; selectedIds: string[] } {
    return {
      document: cloneDocument(this.session.document),
      changeToken: this.session.changeToken,
      selectedIds: [...this.session.selectedIds],
    };
  }

  context(): { changeToken: number; selectedIds: string[] } {
    return { changeToken: this.session.changeToken, selectedIds: [...this.session.selectedIds] };
  }

  selection(): DesignNode[] {
    return this.session.selectedNodes.map((node) => structuredClone(node));
  }

  transact(transaction: DesignTransaction): ExtensionTransactionResult {
    if (!transaction.label.trim()) throw new Error("A canvas transaction needs a label");
    if (!transaction.operations.length || transaction.operations.length > 1_000) throw new Error("A canvas transaction must contain 1 to 1,000 operations");
    this.checkExtensionLocks(transaction);
    const result = applyExternalOperations(this.session, {
      expectedChangeToken: transaction.expectedChangeToken,
      operations: transaction.operations,
    }, {
      label: transaction.label.trim(),
      source: transaction.source,
    });
    if (transaction.selectCreated && result.createdIds.length) this.session.setSelection(result.createdIds);
    return { ...result, selectedIds: [...this.session.selectedIds] };
  }

  preview(transaction: DesignTransaction): ExtensionTransactionResult {
    if (!transaction.label.trim()) throw new Error("A canvas preview needs a label");
    if (!transaction.operations.length || transaction.operations.length > 1_000) throw new Error("A canvas preview must contain 1 to 1,000 operations");
    this.checkExtensionLocks(transaction);
    if (this.session.hasExternalPreview) this.session.cancelExternalPreview();
    const { candidate, createdIds } = prepareExternalOperations(this.session, {
      expectedChangeToken: transaction.expectedChangeToken,
      operations: transaction.operations,
    });
    this.session.previewDocumentFromExternal(candidate, transaction.label.trim(), transaction.source);
    if (transaction.selectCreated && createdIds.length) this.session.setSelection(createdIds);
    return { changeToken: this.session.changeToken, createdIds, selectedIds: [...this.session.selectedIds] };
  }

  commitPreview(): void { this.session.commitExternalPreview(); }

  discardPreview(): void { this.session.cancelExternalPreview(); }
}
