import { object, type JsonObject } from "$lib/codex-protocol";

export type ApprovalRequest = {
  method: string;
  params: JsonObject;
};

export type ApprovalDescription = {
  title: string;
  summary: string;
  details: string[];
  command: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pathLabel(value: unknown): string {
  if (typeof value === "string") return value;
  const path = object(value);
  if (path.type === "path") return text(path.path);
  if (path.type === "glob_pattern") return text(path.pattern);
  if (path.type === "special") return text(path.value).replaceAll("_", " ");
  return "";
}

function permissionDetails(value: unknown): string[] {
  const permissions = object(value);
  const network = object(permissions.network);
  const fileSystem = object(permissions.fileSystem);
  const details: string[] = [];

  if (network.enabled === true) details.push("Use the network");
  for (const path of Array.isArray(fileSystem.read) ? fileSystem.read : []) {
    if (text(path)) details.push(`Read: ${text(path)}`);
  }
  for (const path of Array.isArray(fileSystem.write) ? fileSystem.write : []) {
    if (text(path)) details.push(`Change: ${text(path)}`);
  }
  for (const rawEntry of Array.isArray(fileSystem.entries) ? fileSystem.entries : []) {
    const entry = object(rawEntry);
    const path = pathLabel(entry.path);
    if (!path || entry.access === "deny") continue;
    details.push(`${entry.access === "write" ? "Change" : "Read"}: ${path}`);
  }
  return [...new Set(details)];
}

function sentences(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => /[.!?]$/.test(part) ? part : `${part}.`)
    .join(" ");
}

export function describeApprovalRequest(request: ApprovalRequest): ApprovalDescription {
  const { method, params } = request;
  const reason = text(params.reason);

  if (method === "item/commandExecution/requestApproval") {
    const network = object(params.networkApprovalContext);
    const host = text(network.host);
    const protocol = text(network.protocol);
    const cwd = text(params.cwd);
    const details = permissionDetails(params.additionalPermissions);
    const networkSummary = host ? `Connect to ${host}${protocol ? ` over ${protocol}` : ""}.` : "";
    if (cwd) details.unshift(`Working folder: ${cwd}`);
    if (host && reason) details.unshift(`Network: ${host}${protocol ? ` over ${protocol}` : ""}`);
    return {
      title: "Allow this command?",
      summary: sentences([reason || networkSummary || "Run the command shown below."]),
      details,
      command: text(params.command),
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const root = text(params.grantRoot);
    return {
      title: "Allow these file changes?",
      summary: sentences([root ? `Change files in ${root}.` : "Apply the proposed file changes.", reason]),
      details: [],
      command: "",
    };
  }

  if (method === "item/permissions/requestApproval") {
    const details = permissionDetails(params.permissions);
    const cwd = text(params.cwd);
    return {
      title: "Grant extra access?",
      summary: sentences([reason || (cwd ? `Allow Codex to work outside its current access in ${cwd}.` : "Allow Codex to use the access listed below.")]),
      details,
      command: "",
    };
  }

  if (method === "mcpServer/elicitation/request") {
    const server = text(params.serverName);
    const message = text(params.message);
    const url = text(params.url);
    return {
      title: server ? `Allow ${server} to continue?` : "Allow this tool to continue?",
      summary: sentences([message || "This connected tool needs your approval."]),
      details: url ? [`Open: ${url}`] : [],
      command: "",
    };
  }

  return {
    title: "Codex needs approval",
    summary: "Review this action before Codex continues.",
    details: [],
    command: "",
  };
}
