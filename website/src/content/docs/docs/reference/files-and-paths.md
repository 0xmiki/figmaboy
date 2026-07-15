---
title: Files and paths
description: Locate the Figmaboy workspace, bridge discovery file, installed MCP executable, and development sidecar.
---

## Application data

| Platform | Default directory |
| --- | --- |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/com.miki.figmaboy/` |
| macOS | `~/Library/Application Support/com.miki.figmaboy/` |
| Windows | `%LOCALAPPDATA%\com.miki.figmaboy\` |

The workspace database is `figmaboy.sqlite3`. The live bridge discovery file is `editor-bridge.json`.

## Installed MCP executable

Linux package installs normally expose the executable on `PATH`:

```bash
command -v figmaboy-mcp
```

Installer bundles and standalone installs use these stable paths:

| Installation | MCP path |
| --- | --- |
| Linux `.deb` or `.rpm` | `/usr/bin/figmaboy-mcp` |
| Linux AppImage / standalone | `~/.local/bin/figmaboy-mcp` |
| Native Nix package | The stable profile path returned by `command -v figmaboy-mcp` |
| macOS DMG in Applications | `/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp` |
| macOS standalone fallback | `~/.local/bin/figmaboy-mcp` |
| Windows NSIS (typical per-user install) | `%LOCALAPPDATA%\Figmaboy\figmaboy-mcp.exe` |
| Windows MSI (typical system install) | `%ProgramFiles%\Figmaboy\figmaboy-mcp.exe` |
| Windows standalone fallback | `%LOCALAPPDATA%\Figmaboy\bin\figmaboy-mcp.exe` |

The path registered with `codex mcp add` must keep pointing to the executable. Moving or deleting it breaks future Codex sessions until the entry is replaced.

## Repository development paths

When building from source:

| Artifact | Path |
| --- | --- |
| MCP Rust crate | `src-tauri/mcp/` |
| Public tool contract | `mcp/types.ts` |
| Built release server | `src-tauri/target/release/figmaboy-mcp` |
| Staged Tauri sidecars | `src-tauri/binaries/figmaboy-mcp-<target-triple>` |

Build and register a development server:

```bash
nix-shell --run 'cargo build --locked --release --manifest-path src-tauri/mcp/Cargo.toml'
codex mcp remove figmaboy
codex mcp add figmaboy -- "$(pwd)/src-tauri/target/release/figmaboy-mcp"
```

Start a new Codex session after switching between installed and repository binaries.

## Environment overrides

| Variable | Purpose |
| --- | --- |
| `FIGMABOY_DB_PATH` | Explicit saved workspace database for offline lookup. |
| `FIGMABOY_BRIDGE_FILE` | Explicit live editor discovery file. |

These are intended for portable setups, development, and tests. Standard installations should use platform discovery.
