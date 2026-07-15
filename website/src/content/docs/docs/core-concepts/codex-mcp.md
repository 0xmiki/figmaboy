---
title: Codex and the MCP
description: Learn how Codex discovers Figmaboy tools and how offline reads differ from live editor mutations.
---

`figmaboy-mcp` is a separate local process that Codex launches over stdio. The desktop app does not launch the MCP process itself.

## Two data paths

```text
Codex
  │ JSON-RPC over stdio
  ▼
figmaboy-mcp
  ├── read-only SQLite ───────────► saved pages, layers, previews
  │                                  app open or closed
  │
  └── authenticated loopback ─────► currently open editor
                                     live inspect and edit
```

### Saved context

`designs_list` and `design_context_get` open the local SQLite workspace in read-only mode. They can find a design by copied file ID or unique name and return:

- File and page identity.
- The saved revision.
- The complete native page document.
- An ordered layer tree.
- Asset metadata.
- A visual page preview when available.

The MCP never writes to SQLite. Offline context is therefore safe to use even when the desktop application is closed.

### Live editor tools

When Figmaboy is open, it starts a loopback-only bridge on a random port. A discovery file contains that port, a random authentication token, and the desktop process ID. Live MCP tools connect to that bridge.

Mutations are executed by the editor, where they receive the same validation, history, rendering, revision checks, and autosave behavior as manual edits.

## Optimistic concurrency

`editor_status` and `document_get` return a change token. Codex can pass it as `expectedChangeToken` when applying edits. If the document changed after inspection, Figmaboy rejects the stale edit instead of silently overwriting newer work.

## Tool discovery

At the start of a design task, Codex should inspect:

1. `editor_status` to confirm the active file and page.
2. `design_capabilities` for supported nodes, styles, and hierarchy rules.
3. `types_get` when it needs the exact TypeScript contract.
4. `document_get` for the complete current document and change token.

After editing, it should use `frame_screenshot` for visual review and `document_save` to persist the finished revision.
