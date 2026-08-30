# Figmaboy extension format

Phase 1 extensions are declarative JSON files. They add native controls to the Extensions sidebar and run validated canvas transactions. Figmaboy renders every control. An extension cannot inject HTML, CSS, Svelte components, Tauri commands, filesystem access, or network requests.

## Ask Codex to make a tool

Open a design and ask in the Codex sidebar:

> Make me a reusable tool that applies a chosen corner radius and fill color to the current selection.

Codex reads the extension contract from `design_capabilities` and calls `extension_stage` with a declarative manifest. Figmaboy validates it, opens Extensions, and shows the result as a trial. Codex cannot run its buttons, Keep it, or Discard it. Test the controls and make that decision in the Extensions sidebar.

This workflow supports fixed canvas recipes that Phase 1 can express. If a request needs arbitrary calculations, network access, files, or background behavior, Codex should explain that it is not supported instead of generating code.

## Manual import

Open a design, select Tools in the left rail, then import a `.figmaboy-extension` or JSON file. A new version starts as a trial. You can inspect its panel, run its actions, then keep or discard the tool. Kept versions can be disabled or restored from the Manage tab.

Keeping a version opens a host-owned confirmation when it requests new permissions. Every canvas action is committed as one undo entry. Use `Ctrl+Z` or `Cmd+Z` to revert the complete action.

The working example is [`examples/selection-tools.figmaboy-extension`](../examples/selection-tools.figmaboy-extension).

## Manifest

```json
{
  "format": "figmaboy-extension",
  "apiVersion": 1,
  "id": "local.selection-tools",
  "name": "Selection tools",
  "version": "1.0.0",
  "permissions": ["ui.sidebar", "design.read", "design.write"],
  "contributes": {
    "sidebar": [
      {
        "id": "style",
        "title": "Style selection",
        "controls": [
          { "type": "number", "id": "radius", "label": "Radius", "default": 20 },
          {
            "type": "button",
            "id": "apply",
            "label": "Round selected layers",
            "requiresSelection": true,
            "action": {
              "type": "design.transact",
              "label": "Round selected layers",
              "operations": [
                {
                  "kind": "update",
                  "target": "selection",
                  "patch": { "radius": { "$control": "radius" } }
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```

IDs use lowercase letters, numbers, dots, dashes, and underscores. Versions use semantic versioning. One extension can contribute up to 20 panels and 200 controls per panel.

## Controls

The first API version supports:

- `heading`
- `text`
- `divider`
- `number`
- `input`
- `select`
- `checkbox`
- `button`
- `row`

Input controls store local panel state. An action can insert a typed value anywhere in an operation with `{ "$control": "control-id" }`.

## Canvas transactions

Buttons call `design.transact`. A transaction accepts the native operation kinds already used by the editor and MCP:

- `create` adds a frame, group, shape, text, image, or icon layer.
- `update` changes native layer properties.
- `delete` removes layers.
- `reparent` moves layers into another frame or group.
- `reorder` sets sibling order.

`update`, `delete`, and `reparent` can use `"target": "selection"`. Figmaboy resolves it when the user presses the button.

Figmaboy applies each transaction immediately as one undoable edit. Every transaction checks the current document token, clones the document, validates the full layer tree, and rejects the entire batch if one operation is invalid. Use `Ctrl+Z` or `Cmd+Z` to revert every operation from the button together.

## Storage and lifecycle

The desktop app stores extension manifests in SQLite by SHA-256 hash. It keeps separate active and trial pointers for each extension. Keeping, enabling, disabling, discarding, restoring, and removing versions writes an event to the local lifecycle log.

Browser development mode uses a separate local-storage record with the same repository API.

## Current limits

Phase 1 does not execute extension JavaScript. It supports custom panels and canvas action recipes only. Background logic, event subscriptions, custom importers, network access, filesystem access, and rich custom views need the isolated extension runner planned for a later phase.
