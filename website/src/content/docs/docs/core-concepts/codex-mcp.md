---
title: Codex and the MCP
description: Learn how Codex discovers Figmaboy tools and how offline reads differ from live editor mutations.
---

Figmaboy starts `codex app-server` when you open its Codex sidebar. App-server launches the bundled `figmaboy-mcp` process over stdio using a process-local configuration override, so the integrated chat does not modify your global Codex configuration.

## Two data paths

```text
Figmaboy sidebar
  │ app-server protocol over stdio
  ▼
Codex app-server
  │ MCP over stdio
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

The MCP never writes to SQLite. Offline context works while the desktop application is closed.

### Live editor tools

When Figmaboy is open, it starts a loopback-only bridge on a random port. A discovery file contains that port, a random authentication token, and the desktop process ID. Live MCP tools connect to that bridge.

The editor applies each mutation. It uses the same validation, history, rendering, revision checks, and autosave path as a manual edit.

## Optimistic concurrency

`editor_status` and `document_get` return a change token. Codex can pass it as `expectedChangeToken` when applying edits. If the document changed after inspection, Figmaboy rejects the stale edit instead of silently overwriting newer work.

## Tool discovery

The integrated sidebar tells each new thread which Figmaboy file is open. It supplies the bundled MCP without changing global Codex configuration. Only [external Codex clients](../../getting-started/connect-codex/) need a separate MCP installation.

The model picker comes from app-server's paginated `model/list` catalog. Figmaboy validates reasoning and service-tier choices against the selected model, then uses the effective values returned by `thread/start` and `thread/resume`. This prevents the composer from displaying a stale model configuration after switching chats.

At the start of a design task, Codex should inspect:

1. `editor_status` to confirm the active file and page.
2. `design_capabilities` for supported nodes, styles, and hierarchy rules.
3. `types_get` when it needs the exact TypeScript contract.
4. `document_get` for the complete current document and change token.

After editing, it should use `frame_screenshot` for visual review and `document_save` to persist the finished revision.
