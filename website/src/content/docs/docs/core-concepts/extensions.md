---
title: Extensions
description: Add custom sidebar controls and native canvas actions with local Figmaboy extension files.
---

Figmaboy extensions add controls to the editor without changing the application. The first extension API supports native sidebar panels and validated canvas actions.

Open a design and ask Codex to make a reusable tool. Codex reads the bundled extension contract and stages a declarative manifest through the Figmaboy MCP. The Extensions sidebar opens with the result as a trial. Codex cannot run, Keep, or Discard it for you.

You can also select Tools in the left rail and import a `.figmaboy-extension` or JSON file manually.

## What extensions can do

An extension can add headings, text, number fields, text inputs, selects, checkboxes, rows, and buttons. Buttons can create, update, delete, reparent, and reorder native layers through `design.transact`.

An action can target fixed layer IDs or the current selection. It can read values from the extension's fields, which makes small tools such as spacing controls, style presets, card builders, and layer cleanup panels possible.

Each canvas action becomes one normal undo entry immediately. Use `Ctrl+Z` or `Cmd+Z` to revert every operation from the extension button together.

## Trial and version controls

Imported versions are immutable. The Panels tab shows trial contributions immediately. Choose **Keep** or **Discard** after testing them.

The Manage tab lets you enable or disable a kept extension and restore an older kept version. Figmaboy stores these versions and lifecycle events in its local SQLite database.

## Permission boundary

Phase 1 extensions are declarative files. Figmaboy renders their controls and validates every canvas transaction. They cannot inject HTML, load Svelte components, call Tauri, read arbitrary files, or access the network.

See the [complete extension format on GitHub](https://github.com/0xmiki/figmaboy/blob/main/docs/extensions.md) and the [selection tools example](https://github.com/0xmiki/figmaboy/blob/main/examples/selection-tools.figmaboy-extension).
