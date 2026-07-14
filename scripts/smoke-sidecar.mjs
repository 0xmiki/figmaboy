import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
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

child.stdin.end();
await Promise.race([
  once(child, "exit"),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("The sidecar did not exit after stdin closed")), 5_000),
  ),
]);

console.log(`Verified ${version}: ${listed.tools.length} MCP tools`);
