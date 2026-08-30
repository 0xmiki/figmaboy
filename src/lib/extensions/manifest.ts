import {
  EXTENSION_API_VERSION,
  EXTENSION_FORMAT,
  type ExtensionControl,
  type ExtensionDesignAction,
  type ExtensionManifest,
  type ExtensionPermission,
} from "$lib/extensions/types";

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PERMISSIONS = new Set<ExtensionPermission>(["ui.sidebar", "design.read", "design.write"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return result;
}

function validateAction(value: unknown, label: string): asserts value is ExtensionDesignAction {
  const action = record(value, label);
  if (action.type !== "design.transact") throw new Error(`${label}.type must be design.transact`);
  if (action.mode !== undefined && action.mode !== "commit" && action.mode !== "preview") throw new Error(`${label}.mode must be commit or preview`);
  requiredString(action.label, `${label}.label`, 80);
  if (!Array.isArray(action.operations) || !action.operations.length || action.operations.length > 250) {
    throw new Error(`${label}.operations must contain 1 to 250 operations`);
  }
  action.operations.forEach((value, index) => {
    const operation = record(value, `${label}.operations[${index}]`);
    if (!new Set(["create", "update", "delete", "reparent", "reorder"]).has(String(operation.kind))) {
      throw new Error(`${label}.operations[${index}].kind is unsupported`);
    }
    if (operation.target !== undefined && operation.target !== "selection") {
      throw new Error(`${label}.operations[${index}].target must be selection`);
    }
  });
}

function validateControls(values: unknown, label: string, ids: Set<string>, count: { value: number }, depth = 0): asserts values is ExtensionControl[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (depth > 4) throw new Error("Extension control rows can be nested at most four levels deep");
  for (let index = 0; index < values.length; index += 1) {
    count.value += 1;
    if (count.value > 200) throw new Error("An extension can contribute at most 200 controls");
    const control = record(values[index], `${label}[${index}]`);
    const type = control.type;
    if (!new Set(["heading", "text", "divider", "number", "input", "select", "checkbox", "button", "row"]).has(String(type))) {
      throw new Error(`${label}[${index}].type is unsupported`);
    }
    if (type === "heading" || type === "text") requiredString(control.text, `${label}[${index}].text`, 500);
    if (type === "row") {
      validateControls(control.controls, `${label}[${index}].controls`, ids, count, depth + 1);
      continue;
    }
    if (["number", "input", "select", "checkbox", "button"].includes(String(type))) {
      const id = requiredString(control.id, `${label}[${index}].id`, 80);
      if (!ID_PATTERN.test(id)) throw new Error(`${label}[${index}].id contains unsupported characters`);
      if (ids.has(id)) throw new Error(`Control ID ${id} is used more than once`);
      ids.add(id);
      requiredString(control.label, `${label}[${index}].label`, 120);
    }
    if (type === "select") {
      if (!Array.isArray(control.options) || !control.options.length || control.options.length > 50) throw new Error(`${label}[${index}].options must contain 1 to 50 choices`);
      control.options.forEach((option, optionIndex) => {
        const item = record(option, `${label}[${index}].options[${optionIndex}]`);
        requiredString(item.label, `${label}[${index}].options[${optionIndex}].label`, 120);
        requiredString(item.value, `${label}[${index}].options[${optionIndex}].value`, 120);
      });
    }
    if (type === "button") validateAction(control.action, `${label}[${index}].action`);
  }
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  const manifest = record(value, "Extension manifest");
  if (manifest.format !== EXTENSION_FORMAT) throw new Error(`format must be ${EXTENSION_FORMAT}`);
  if (manifest.apiVersion !== EXTENSION_API_VERSION) throw new Error(`apiVersion must be ${EXTENSION_API_VERSION}`);
  const id = requiredString(manifest.id, "id", 120);
  if (!ID_PATTERN.test(id)) throw new Error("id must use lowercase letters, numbers, dots, dashes, or underscores");
  requiredString(manifest.name, "name", 120);
  const version = requiredString(manifest.version, "version", 80);
  if (!VERSION_PATTERN.test(version)) throw new Error("version must use semantic versioning, for example 1.0.0");
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some((permission) => typeof permission !== "string" || !PERMISSIONS.has(permission as ExtensionPermission))) {
    throw new Error("permissions contains an unsupported capability");
  }
  const permissions = new Set(manifest.permissions as ExtensionPermission[]);
  const contributes = record(manifest.contributes, "contributes");
  if (!Array.isArray(contributes.sidebar) || !contributes.sidebar.length || contributes.sidebar.length > 20) {
    throw new Error("contributes.sidebar must contain 1 to 20 panels");
  }
  if (!permissions.has("ui.sidebar")) throw new Error("Sidebar contributions require the ui.sidebar permission");
  const panelIds = new Set<string>();
  let writes = false;
  contributes.sidebar.forEach((value, index) => {
    const panel = record(value, `contributes.sidebar[${index}]`);
    const panelId = requiredString(panel.id, `contributes.sidebar[${index}].id`, 80);
    if (!ID_PATTERN.test(panelId)) throw new Error(`contributes.sidebar[${index}].id contains unsupported characters`);
    if (panelIds.has(panelId)) throw new Error(`Sidebar panel ID ${panelId} is used more than once`);
    panelIds.add(panelId);
    requiredString(panel.title, `contributes.sidebar[${index}].title`, 120);
    const ids = new Set<string>();
    validateControls(panel.controls, `contributes.sidebar[${index}].controls`, ids, { value: 0 });
    const visit = (controls: ExtensionControl[]) => controls.forEach((control) => {
      if (control.type === "button") writes = true;
      if (control.type === "row") visit(control.controls);
    });
    visit(panel.controls as ExtensionControl[]);
  });
  if (writes && !permissions.has("design.write")) throw new Error("Canvas actions require the design.write permission");
  return structuredClone(manifest) as unknown as ExtensionManifest;
}

export function extensionManifestFromText(text: string): ExtensionManifest {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("The extension file is not valid JSON"); }
  return parseExtensionManifest(value);
}
