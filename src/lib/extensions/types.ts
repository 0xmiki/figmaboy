import type { DesignNode } from "$lib/domain";

export const EXTENSION_FORMAT = "figmaboy-extension";
export const EXTENSION_API_VERSION = 1;

export type ExtensionPermission = "ui.sidebar" | "design.read" | "design.write";

export interface ControlValueReference {
  $control: string;
}

export type ExtensionValue = string | number | boolean | null | ControlValueReference | ExtensionValue[] | { [key: string]: ExtensionValue };

export type ExtensionDesignOperation =
  | { kind: "create"; node: Record<string, ExtensionValue>; parentId?: string | null; index?: number }
  | { kind: "update"; id?: string; target?: "selection"; patch: Record<string, ExtensionValue> }
  | { kind: "delete"; ids?: string[]; target?: "selection" }
  | { kind: "reparent"; ids?: string[]; target?: "selection"; parentId: string | null; index?: number }
  | { kind: "reorder"; ids: string[]; parentId: string | null };

export interface ExtensionDesignAction {
  type: "design.transact";
  label: string;
  operations: ExtensionDesignOperation[];
  selectCreated?: boolean;
  /** @deprecated Canvas actions now commit immediately as one undo entry. */
  mode?: "commit" | "preview";
}

export type ExtensionControl =
  | { type: "heading"; text: string }
  | { type: "text"; text: string; tone?: "default" | "muted" | "warning" }
  | { type: "divider" }
  | { type: "number"; id: string; label: string; default?: number; min?: number; max?: number; step?: number }
  | { type: "input"; id: string; label: string; default?: string; placeholder?: string }
  | { type: "select"; id: string; label: string; default?: string; options: { label: string; value: string }[] }
  | { type: "checkbox"; id: string; label: string; default?: boolean }
  | { type: "button"; id: string; label: string; action: ExtensionDesignAction; requiresSelection?: boolean; variant?: "default" | "primary" | "danger" }
  | { type: "row"; controls: ExtensionControl[] };

export interface ExtensionSidebarContribution {
  id: string;
  title: string;
  controls: ExtensionControl[];
}

export interface ExtensionManifest {
  format: typeof EXTENSION_FORMAT;
  apiVersion: typeof EXTENSION_API_VERSION;
  id: string;
  name: string;
  version: string;
  permissions: ExtensionPermission[];
  contributes: {
    sidebar: ExtensionSidebarContribution[];
  };
}

export interface ExtensionVersionSummary {
  hash: string;
  version: string;
  createdAt: string;
  status: "candidate" | "release";
}

export interface InstalledExtension {
  id: string;
  name: string;
  enabled: boolean;
  activeHash: string | null;
  previewHash: string | null;
  active: ExtensionManifest | null;
  preview: ExtensionManifest | null;
  versions: ExtensionVersionSummary[];
}

export interface ExtensionTransactionResult {
  changeToken: number;
  createdIds: string[];
  selectedIds: string[];
}

export interface ExtensionActionContext {
  controls: Record<string, string | number | boolean>;
  selectedIds: string[];
  selectedNodes: DesignNode[];
}
