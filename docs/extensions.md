# Figmaboy extension format

Phase 1 extensions are declarative JSON files. They add native controls to the Extensions sidebar and run validated canvas transactions. Figmaboy renders every control. An extension cannot inject HTML, CSS, Svelte components, Tauri commands, filesystem access, or network requests.

Open a design, select the puzzle-piece button in the bottom toolbar, then import a `.figmaboy-extension` or JSON file. A new version starts as a trial. You can inspect its panel, test preview actions, then keep or discard it. Kept versions can be disabled or restored from the Manage tab.

Keeping a version opens a host-owned confirmation when it requests new permissions. Trial canvas actions always use preview mode, even if their manifest requests an immediate commit.

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
              "mode": "preview",
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

Set `"mode": "preview"` to apply the transaction to a temporary document. Autosave pauses and the canvas locks until the user selects Apply or Discard. Applying the preview creates one undo entry. Discard restores the exact document from before the action.

Without preview mode, Figmaboy applies the transaction immediately as one undoable edit. Every transaction checks the current document token, clones the document, validates the full layer tree, and rejects the entire batch if one operation is invalid.

## Storage and lifecycle

The desktop app stores extension manifests in SQLite by SHA-256 hash. It keeps separate active and trial pointers for each extension. Keeping, enabling, disabling, discarding, restoring, and removing versions writes an event to the local lifecycle log.

Browser development mode uses a separate local-storage record with the same repository API.

## Current limits

Phase 1 does not execute extension JavaScript. It supports custom panels and canvas action recipes only. Background logic, event subscriptions, custom importers, network access, filesystem access, and rich custom views need the isolated extension runner planned for a later phase.
