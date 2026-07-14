import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(repositoryRoot, "src-tauri");
const manifestPath = join(tauriDir, "mcp", "Cargo.toml");
const targetDir = resolve(
  repositoryRoot,
  process.env.CARGO_TARGET_DIR ?? join("src-tauri", "target"),
);
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const profile = debug ? "debug" : "release";

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hostTarget() {
  return execFileSync("rustc", ["--print", "host-tuple"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

const target =
  option("--target") ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTarget();

function executableName(targetTriple) {
  return `figmaboy-mcp${targetTriple.includes("windows") ? ".exe" : ""}`;
}

function build(targetTriple) {
  const cargoArgs = [
    "build",
    "--locked",
    "--manifest-path",
    manifestPath,
    "--target-dir",
    targetDir,
    "--bin",
    "figmaboy-mcp",
    "--target",
    targetTriple,
  ];
  if (!debug) cargoArgs.push("--release");

  const result = spawnSync("cargo", cargoArgs, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return join(targetDir, targetTriple, profile, executableName(targetTriple));
}

const binariesDir = join(tauriDir, "binaries");
mkdirSync(binariesDir, { recursive: true });
const destination = join(
  binariesDir,
  `figmaboy-mcp-${target}${target.includes("windows") ? ".exe" : ""}`,
);

if (target === "universal-apple-darwin") {
  const armBinary = build("aarch64-apple-darwin");
  const intelBinary = build("x86_64-apple-darwin");
  execFileSync("lipo", ["-create", armBinary, intelBinary, "-output", destination], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
} else {
  copyFileSync(build(target), destination);
}

if (!target.includes("windows")) chmodSync(destination, 0o755);
console.log(`Prepared ${destination}`);
