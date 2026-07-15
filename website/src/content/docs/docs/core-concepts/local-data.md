---
title: Local data and autosave
description: Understand what Figmaboy saves locally, where it lives, and how the MCP reads it safely.
---

Figmaboy is local-first. Projects, files, page documents, assets, and page previews are stored in `figmaboy.sqlite3` inside the platform application-data directory.

## Default paths

| Platform | Application-data directory |
| --- | --- |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/com.miki.figmaboy/` |
| macOS | `~/Library/Application Support/com.miki.figmaboy/` |
| Windows | `%LOCALAPPDATA%\com.miki.figmaboy\` |

The main files are:

```text
com.miki.figmaboy/
├── figmaboy.sqlite3       # workspace, documents, assets, previews
├── figmaboy.sqlite3-wal   # SQLite write-ahead log while active
├── figmaboy.sqlite3-shm   # SQLite shared-memory file while active
└── editor-bridge.json     # live editor discovery, present while available
```

Do not edit the database manually. Copy all three SQLite files together when taking a raw backup while Figmaboy might be running, or close the app before copying `figmaboy.sqlite3`.

## Autosave

Document changes are debounced and persisted locally. The editor shows the current save state near the file name. `document_save` lets Codex request an immediate save at the end of a task.

Each page has a revision number. Offline context reports the latest saved revision—not unsaved in-memory changes that exist only in an open editor.

## MCP overrides

Portable setups and tests can set:

- `FIGMABOY_DB_PATH` to an explicit `figmaboy.sqlite3` path for offline reads.
- `FIGMABOY_BRIDGE_FILE` to an explicit `editor-bridge.json` path for live access.

Set these variables for the `figmaboy-mcp` process only. Most installations should use automatic discovery.

## Privacy boundary

Saved-design lookup is a local read-only database operation. Live access is restricted to `127.0.0.1` and authenticated with a random token. Codex still has the filesystem and tool permissions of the environment in which you launch it, so review your normal Codex sandbox and approval settings separately.
