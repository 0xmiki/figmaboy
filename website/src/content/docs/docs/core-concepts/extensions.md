---
title: Extensions
description: Add custom sidebar controls and native canvas actions with local Figmaboy extension files.
---

Figmaboy extensions add controls to the editor without changing the application. The first extension API supports native sidebar panels and validated canvas actions.

Open a design and select the puzzle-piece button in the bottom toolbar. Import a `.figmaboy-extension` or JSON file. Figmaboy opens the new version as a trial so you can inspect and test it before keeping it.

## What extensions can do

An extension can add headings, text, number fields, text inputs, selects, checkboxes, rows, and buttons. Buttons can create, update, delete, reparent, and reorder native layers through `design.transact`.

An action can target fixed layer IDs or the current selection. It can read values from the extension's fields, which makes small tools such as spacing controls, style presets, card builders, and layer cleanup panels possible.

Canvas actions can use preview mode. Figmaboy shows the result on a temporary document and pauses autosave. Select **Apply** to create one undo entry, or **Discard** to restore the document.

## Trial and version controls

Imported versions are immutable. The Panels tab shows trial contributions immediately. Choose **Keep** or **Discard** after testing them.

The Manage tab lets you enable or disable a kept extension and restore an older kept version. Figmaboy stores these versions and lifecycle events in its local SQLite database.

## Permission boundary

Phase 1 extensions are declarative files. Figmaboy renders their controls and validates every canvas transaction. They cannot inject HTML, load Svelte components, call Tauri, read arbitrary files, or access the network.

See the [complete extension format on GitHub](https://github.com/0xmiki/figmaboy/blob/main/docs/extensions.md) and the [selection tools example](https://github.com/0xmiki/figmaboy/blob/main/examples/selection-tools.figmaboy-extension).
