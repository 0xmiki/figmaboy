import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const target =
  option("--target") ??
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = target.includes("windows") ? ".exe" : "";
const binary = join(
  repositoryRoot,
  "src-tauri",
  "binaries",
  `figmaboy-mcp-${target}${extension}`,
);

if (!existsSync(binary)) {
  throw new Error(`Missing ${binary}; run bun run sidecar:prepare first`);
}

const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
if (!/^figmaboy-mcp \d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Unexpected version output: ${version}`);
}

const fixtureDirectory = mkdtempSync(join(tmpdir(), "figmaboy-mcp-smoke-"));
const databasePath = join(fixtureDirectory, "figmaboy.sqlite3");
const database = new Database(databasePath, { create: true });
database.exec(`
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT, trashed_at TEXT);
  CREATE TABLE design_files (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT, starred INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT, last_opened_at TEXT, trashed_at TEXT, thumbnail TEXT
  );
  CREATE TABLE pages (
    id TEXT PRIMARY KEY, file_id TEXT, name TEXT, position INTEGER,
    revision INTEGER DEFAULT 0, document_json TEXT, preview TEXT
  );
  CREATE TABLE assets (id TEXT PRIMARY KEY, mime TEXT, width INTEGER, height INTEGER);
  INSERT INTO projects VALUES ('project_smoke', 'Smoke project', '2026-01-01', '2026-01-01', NULL);
  INSERT INTO design_files VALUES ('file_smoke', 'project_smoke', 'Offline smoke design', 0, '2026-01-01', '2026-01-02', NULL, NULL, NULL);
  INSERT INTO pages VALUES (
    'page_smoke', 'file_smoke', 'Home', 0, 7,
    '{"schemaVersion":1,"rootIds":["frame_smoke"],"nodes":{"frame_smoke":{"id":"frame_smoke","name":"Home screen","type":"frame","x":0,"y":0,"width":100,"height":50,"rotation":0,"visible":true,"opacity":1,"childIds":[]}}}',
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiPjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiIGZpbGw9IiMwZDk5ZmYiLz48L3N2Zz4='
  );
`);
database.close();

const child = spawn(binary, [], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, FIGMABOY_DB_PATH: databasePath },
});
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const pending = new Map();
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params = undefined) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}; stderr: ${stderr}`));
    }, 10_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  });
}

const initialized = await request(1, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "figmaboy-sidecar-smoke", version: "0.1.0" },
});
if (initialized.serverInfo?.name !== "figmaboy-mcp") {
  throw new Error(`Unexpected server info: ${JSON.stringify(initialized.serverInfo)}`);
}

send({ jsonrpc: "2.0", method: "notifications/initialized" });
const listed = await request(2, "tools/list", {});
if (!Array.isArray(listed.tools) || listed.tools.length === 0) {
  throw new Error("The sidecar returned no MCP tools");
}
const toolNames = new Set(listed.tools.map((tool) => tool.name));
for (const name of ["designs_list", "design_context_get"]) {
  if (!toolNames.has(name)) throw new Error(`The sidecar did not expose ${name}`);
}

const designs = await request(3, "tools/call", {
  name: "designs_list",
  arguments: { query: "offline smoke" },
});
if (designs.isError || designs.structuredContent?.designs?.[0]?.id !== "file_smoke") {
  throw new Error(`Offline design listing failed: ${JSON.stringify(designs)}`);
}

const context = await request(4, "tools/call", {
  name: "design_context_get",
  arguments: { fileId: "file_smoke", pageName: "Home" },
});
if (
  context.isError ||
  context.structuredContent?.page?.revision !== 7 ||
  context.structuredContent?.layerTree?.[0]?.id !== "frame_smoke" ||
  !context.content?.some((item) => item.type === "image" && item.mimeType === "image/png")
) {
  throw new Error(`Offline design context failed: ${JSON.stringify(context)}`);
}

child.stdin.end();
await Promise.race([
  once(child, "exit"),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("The sidecar did not exit after stdin closed")), 5_000),
  ),
]);
rmSync(fixtureDirectory, { recursive: true, force: true });

console.log(`Verified ${version}: ${listed.tools.length} MCP tools with closed-app design context`);
