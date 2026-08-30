# Canvas interaction audit

## Architecture map

- `EditorSession` owns persistent page content, command history, selection, tool state, clipboard state, save dirtiness, and the boundary between preview gestures and committed actions.
- `EditorCanvas` owns the explicit pointer mode (`idle`, `pan`, `draw`, `text`, `edit-text`, `move`, `marquee`, `resize`, `rotate`), pointer capture, start snapshots, preview geometry, and cancellation.
- The editor route owns focus-filtered global commands, autosave orchestration, viewport fit/zoom commands, import/export, and application chrome.
- `document-validation.ts` is the trust boundary for persisted, imported, clipboard, RPC-replaced, and page-switched documents.
- The repository persists only versioned `PageDocument` values and keeps a last-known-good browser backup.

## Findings

1. Autosave could capture an active drag, drawing draft, or Alt-duplicate. Pointer interactions now pause persistence and advance the change token only when they commit.
2. Escape, pointer cancellation, focus loss, tool changes, zoom changes, and removed targets could leave a gesture active. They now use one cancellation and reset routine.
3. Viewport state lived in content history, no-op commands created entries, and repeated nudges created one entry per key event. History now keeps the live viewport, ignores no-ops, and groups each gesture or nudge run.
4. Browser state, imports, clipboard JSON, and external replacements trusted arbitrary objects and references. Validation now repairs cycles and references, removes invalid nodes, and remaps colliding asset IDs.
5. Grouping, layer drag and drop, alignment, and rotation treated local coordinates as if every parent had zero rotation. These commands now convert through world and parent matrices.
6. Multi-selection collapsed on pointer down, small pointer jitter moved objects, thin lines were hard to hit, repeated paste overlapped, and marquee rules were unclear. Selection is now canonical. Movement has a screen-space threshold, lines have larger hit targets, paste offsets each copy, and marquee direction controls containment.
7. Cursors, oriented selection handles, pointer-centered zoom, 100% zoom, anchor snapping, and focus isolation now match the active operation.

## Behavior decisions

- Four screen pixels distinguish a click from a move, independent of zoom.
- Left-to-right marquee requires full containment; right-to-left marquee selects intersections. Shift adds and Alt subtracts.
- Escape cancels pointer previews. In text editing it accepts the current text and exits; a newly created empty text layer is discarded.
- Viewport changes persist locally but do not participate in content Undo/Redo.
- A completed pointer transform, drawing gesture, alignment, hierarchy change, or nudge run is one history entry. Selection-only changes are not history entries.
- Tool switching cancels unfinished pointer previews but commits valid text editing before activating the requested tool.
- Invalid parents and cycles are promoted to safe roots. Unknown fields on otherwise valid objects are retained for forward compatibility.
- Locked layers cannot be hit on canvas but can be selected from Layers for inspection/unlocking.
