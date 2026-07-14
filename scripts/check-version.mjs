import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function json(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function cargoVersion(path) {
  const source = readFileSync(join(root, path), "utf8");
  const packageStart = source.indexOf("[package]");
  if (packageStart === -1) throw new Error(`Could not find [package] in ${path}`);

  const remaining = source.slice(packageStart + "[package]".length);
  const nextSection = remaining.search(/^\[/m);
  const packageSection = nextSection === -1 ? remaining : remaining.slice(0, nextSection);
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error(`Could not read package version from ${path}`);
  return version;
}

const versions = new Map([
  ["package.json", json("package.json").version],
  ["src-tauri/tauri.conf.json", json("src-tauri/tauri.conf.json").version],
  ["src-tauri/Cargo.toml", cargoVersion("src-tauri/Cargo.toml")],
  ["src-tauri/mcp/Cargo.toml", cargoVersion("src-tauri/mcp/Cargo.toml")],
]);

const unique = new Set(versions.values());
if (unique.size !== 1) {
  throw new Error(`Version mismatch:\n${[...versions].map(([path, version]) => `- ${path}: ${version}`).join("\n")}`);
}

const [version] = unique;
const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== `v${version}`) {
  throw new Error(`Release tag ${releaseTag} does not match package version v${version}`);
}

console.log(`Verified Figmaboy version ${version}${releaseTag ? ` for ${releaseTag}` : ""}`);
