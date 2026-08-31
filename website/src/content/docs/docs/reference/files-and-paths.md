---
title: Files and paths
description: Locate the Figmaboy workspace, bridge discovery file, and development sidecar.
---

## Application data

| Platform | Default directory |
| --- | --- |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/com.miki.figmaboy/` |
| macOS | `~/Library/Application Support/com.miki.figmaboy/` |
| Windows | `%LOCALAPPDATA%\com.miki.figmaboy\` |

The workspace database is `figmaboy.sqlite3`. The live bridge discovery file is `editor-bridge.json`.

## Repository development paths

When building from source:

| Artifact | Path |
| --- | --- |
| MCP Rust crate | `src-tauri/mcp/` |
| Public tool contract | `mcp/types.ts` |
| Built release server | `src-tauri/target/release/figmaboy-mcp` |
| Staged Tauri sidecars | `src-tauri/binaries/figmaboy-mcp-<target-triple>` |

<details>
<summary>Build the development server</summary>

```bash
nix-shell --run 'cargo build --locked --release --manifest-path src-tauri/mcp/Cargo.toml'
```

</details>

## Environment overrides

| Variable | Purpose |
| --- | --- |
| `FIGMABOY_DB_PATH` | Explicit saved workspace database for offline lookup. |
| `FIGMABOY_BRIDGE_FILE` | Explicit live editor discovery file. |

These are intended for portable setups, development, and tests. Standard installations should use platform discovery.
