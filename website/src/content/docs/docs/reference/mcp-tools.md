---
title: MCP tools
description: Reference for Figmaboy's offline-context, live inspection, mutation, history, and rendering tools.
---

The server advertises its exact runtime schema to Codex. Use `types_get` when you need complete field-level contracts; this page is the human-readable map.

## Offline context

These tools work while Figmaboy is closed.

| Tool | Purpose |
| --- | --- |
| `designs_list` | Search saved designs and return IDs, names, projects, timestamps, and page counts. |
| `design_context_get` | Load a saved page by file ID or name with the document, ordered layers, assets, revision, and preview. |

## Inspect and understand

These tools require an open design.

| Tool | Purpose |
| --- | --- |
| `editor_status` | Active file/page, save state, selection, change token, viewport, and canvas geometry. |
| `design_capabilities` | Supported node/style capabilities and required semantic hierarchy conventions. |
| `types_get` | Complete TypeScript contract for every node, style, operation, and tool. |
| `document_get` | Complete open page document, ordered layer tree, and change token. |
| `nodes_get` | Fetch exact node records by ID or filter all nodes by type/name. |
| `geometry_get` | Local, world, canvas-client, and rotated-corner geometry. |

## Edit

| Tool | Purpose |
| --- | --- |
| `operations_apply` | Atomically create, update, delete, reparent, or reorder native layers. |
| `nodes_center` | Center layers horizontally, vertically, or both relative to a parent or selection. |
| `nodes_set_border_radius` | Set uniform or independent radii on frames, rectangles, and images. |
| `image_place` | Persist and place a local PNG, JPEG, or WebP as an image layer. |
| `selection_set` | Replace the editor selection with exact node IDs. |
| `viewport_focus` | Fit the viewport to specified nodes or the complete design. |

`operations_apply`, `nodes_center`, `nodes_set_border_radius`, and `image_place` accept an optional `expectedChangeToken` for optimistic concurrency.

## Review, history, and persistence

| Tool | Purpose |
| --- | --- |
| `frame_screenshot` | Capture one complete frame and its descendants as PNG evidence. |
| `render` | Render the full design or selected nodes to PNG. |
| `history_undo` | Undo the most recent editor mutation. |
| `history_redo` | Redo the most recently undone mutation. |
| `document_save` | Immediately persist the open page and return its revision/save state. |

## Authoring rules

For maintainable output, Codex should:

1. Inspect capabilities, types when needed, and the current document.
2. Create named parent containers before their children.
3. Use one top-level frame per screen and semantic section/component groups.
4. Remember that child coordinates are parent-local.
5. Apply related changes atomically.
6. Capture and inspect a complete frame screenshot.
7. Refine visible issues and save.
