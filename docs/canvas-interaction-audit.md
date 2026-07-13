# Canvas interaction audit

## Architecture map

- `EditorSession` owns persistent page content, command history, selection, tool state, clipboard state, save dirtiness, and the boundary between preview gestures and committed actions.
- `EditorCanvas` owns the explicit pointer mode (`idle`, `pan`, `draw`, `text`, `edit-text`, `move`, `marquee`, `resize`, `rotate`), pointer capture, start snapshots, preview geometry, and cancellation.
- The editor route owns focus-filtered global commands, autosave orchestration, viewport fit/zoom commands, import/export, and application chrome.
- `document-validation.ts` is the trust boundary for persisted, imported, clipboard, RPC-replaced, and page-switched documents.
- The repository persists only versioned `PageDocument` values and keeps a last-known-good browser backup.

## Severity-ranked findings and disposition

1. **Data loss / corruption:** autosave could serialize an in-progress drag, draw draft, or Alt-duplicate. Pointer interactions now pause persistence and only advance the change token at commit.
2. **Broken state:** Escape, pointer cancellation, focus loss, tool changes, zoom changes, and removed targets could leave gestures alive. All paths now converge on one cancellation/reset routine.
3. **Broken history:** viewport state was embedded in content undo, no-op commands created entries, and repeated nudges created one entry per key event. History now preserves the live viewport, ignores no-ops, and groups gestures/nudges by intention.
4. **Document corruption:** browser state, imports, clipboard JSON, and external document replacement trusted arbitrary shapes and references. Documents are now normalized, cycles/references repaired, invalid nodes removed, and package assets remapped on collision.
5. **Surprising geometry:** group/ungroup, layer drag/drop, alignment, and rotation used local coordinates as though every parent were unrotated. These commands now convert through world/parent matrices.
6. **Interaction friction:** multi-selection collapsed at pointer-down, tiny jitter moved objects, thin lines were hard to hit, repeated paste overlapped, and marquee rules were ambiguous. Selection is canonical, movement has a screen-space threshold, lines have tolerant hit areas/endpoints, paste cascades, and marquee direction has defined containment behavior.
7. **Polish:** cursors, oriented single-selection handles, pointer-centered zoom, 100% zoom, anchor snapping, and focus isolation now communicate and preserve the intended operation.

## Behavior decisions

- Four screen pixels distinguish a click from a move, independent of zoom.
- Left-to-right marquee requires full containment; right-to-left marquee selects intersections. Shift adds and Alt subtracts.
- Escape cancels pointer previews. In text editing it accepts the current text and exits; a newly created empty text layer is discarded.
- Viewport changes persist locally but do not participate in content Undo/Redo.
- A completed pointer transform, drawing gesture, alignment, hierarchy change, or nudge run is one history entry. Selection-only changes are not history entries.
- Tool switching cancels unfinished pointer previews but commits valid text editing before activating the requested tool.
- Invalid parents and cycles are promoted to safe roots. Unknown fields on otherwise valid objects are retained for forward compatibility.
- Locked layers cannot be hit on canvas but can be selected from Layers for inspection/unlocking.
