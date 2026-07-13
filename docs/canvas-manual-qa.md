# Canvas interaction manual QA

Run this checklist in both the browser build and the Tauri shell. Repeat the transform sections at 5%, 25%, 100%, 400%, and 800% zoom where practical.

## Pointer and selection

- Click an object, another object, and empty canvas; selection should replace, replace, and clear.
- Shift-click two objects, then Shift-click one again; it should add and then remove without moving either object.
- With multiple objects selected, press-drag one selected object; the whole selection should move. A click without a drag should collapse to that object.
- Move the pointer fewer than four screen pixels while clicking; geometry must not change and Undo must not gain an entry.
- Drag a marquee left-to-right; only fully enclosed unlocked, visible objects should select. Drag right-to-left; touched objects should select.
- Shift-marquee adds and Alt-marquee subtracts from the existing selection.
- Try thin horizontal, vertical, and diagonal lines; the invisible hit target should make them selectable without changing their appearance.
- Cmd/Ctrl-click repeatedly where objects overlap; selection should cycle through the hit stack.
- Delete a selected container with children, undo, and redo; the hierarchy and selection must remain coherent.

## Move, resize, rotate, and hierarchy

- Drag at each zoom level. The object must not jump on pointer-down and must remain selected on pointer-up.
- Hold Shift while moving to constrain the dominant axis. Hold Alt before or during a drag to create and move one duplicate.
- Move near another object's left, center, right, top, middle, and bottom anchors; the magenta guide and snap should agree.
- Resize every handle. Hold Shift on a corner to preserve aspect ratio and Alt to resize from center.
- Resize a rotated object; its opposite anchor should remain fixed and its handles should follow its rotation.
- Resize both endpoints of lines and arrows. Shift should constrain the endpoint angle to 45-degree increments.
- Rotate one and multiple objects. Shift should snap to 15-degree increments; multi-selection members should orbit the common center.
- Drag a layer into and out of rotated frames, and reorder it in the Layers panel. Its world-space appearance must not jump.
- Group and ungroup rotated children, then undo/redo. Positions, rotations, and stacking order should be preserved.
- During any pointer transform, press Escape, switch tools, trigger Undo externally, blur the window, or remove the target. The preview should revert and no partial state should be saved.

## Draw and text

- A click with a shape tool creates nothing. A drag in all four directions creates positive, stable geometry.
- Hold Shift while drawing boxes/ellipses for a square/circle and while drawing lines for 45-degree constraints.
- Begin drawing, then press Escape, switch tools, or blur the window; no draft layer should remain in the document or history.
- Click with the Text tool for auto-width text and drag for fixed-width text. Verify focus and caret placement.
- Double-click existing text, type several characters and line breaks, then press Escape or click outside. The edit should be one undoable intention.
- Create empty text and leave editing; the empty draft should disappear without adding an Undo entry.
- Edit rotated and nested text at several zoom levels; the textarea should track the rendered text transform.
- Focus text, a numeric field, a select, and a content-editable control; canvas shortcuts must not fire.

## Pan and zoom

- Hold Space before pointer-down and drag; the viewport, never an object, should move. Middle-mouse and the Hand tool should do the same.
- Press Escape or blur while panning; the viewport should return to its starting point.
- Use a mouse wheel/touchpad to pan in both axes. Pinch or Ctrl/Cmd-wheel around each canvas quadrant; the world point below the pointer should remain fixed.
- Use `+`, `-`, Shift-0, Shift-1, and Shift-2 for zoom in, zoom out, 100%, fit all, and fit selection.
- Start a transform and then zoom; the transform should cancel before the viewport changes rather than jump.

## Keyboard, clipboard, and history

- Verify Undo/Redo, Copy/Cut/Paste, Duplicate, Delete, Select All, Group/Ungroup, layer ordering, and Enter hierarchy navigation.
- Paste repeatedly; each copy should remain editable, selected, and offset farther than the last.
- Hold an arrow key; repeated nudges should collapse into one Undo step. Shift-arrow should move ten units.
- Verify a drag, resize, rotate, draw, Alt-drag, text edit, alignment, group, and layer move each create exactly one Undo entry.
- Undo document edits after zooming/panning; the current viewport should not rewind.

## Persistence, import, export, and recovery

- Refresh immediately after a completed action and after autosave reports Saved locally; the committed document and viewport should return.
- Keep a drag active longer than the autosave delay; reload from a second window or inspect storage and confirm the preview was never persisted.
- Make edits rapidly while a save is in flight; Saved locally should only appear after the newest change is written.
- Corrupt the primary browser storage value and retain its `.backup`; reopen and verify recovery. Corrupt both and verify a safe empty workspace.
- Import packages with missing nodes, unsupported node types, negative sizes, invalid numbers, broken parents, cycles, bad paints, and colliding asset IDs. The import should reject or repair atomically, never partially merge.
- Export SVG/PNG with no selection, a nested selection, rotated layers, clipped frames, text, gradients, and missing image assets. Selection UI and guides must not appear in output.

## Known limitations to watch

- Multi-selection resize uses the world-axis bounding box; unlike single-object resize, it does not preserve each rotated object's oriented handles.
- Grouping intentionally requires selected roots to share a parent. Cross-parent grouping is ignored to avoid silently changing geometry.
- Snapping covers object anchors during moves; resize snapping, spacing/distribution guides, and configurable grids are not yet implemented.
- Touch uses pointer events and stable capture, but dedicated two-finger pan and mobile-sized transform handles still need device testing.
