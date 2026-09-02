# Changelog

## 0.5.4, 2026-09-03

### Added

- Shape Boy is the new Figmaboy mark across the desktop app, installers, website, documentation, and repository.
- The landing page uses the real Sonic 60 design inside a proportional reconstruction of the Figmaboy editor and Codex sidebar.

### Changed

- The new landing page now lives at the main website route. The temporary `/v2` route and retired landing design have been removed.
- The documentation and download page now share the landing page's typography, colors, spacing, navigation, and controls.
- The download page keeps platform detection and release hydration while presenting the recommended installer and complete platform list with simpler labels.

## 0.5.3, 2026-09-02

### Added

- `/evolve` now reconstructs a selected frame from first principles in a new sibling frame while keeping the original as a frozen visual and semantic reference.
- Each reconstruction pass has one visible completion condition and a host-enforced budget of five operations and four new layers, so the design appears on the canvas layer by layer.

### Changed

- Evolve uses one sequential designer instead of three parallel candidates. Fresh directors choose the next focused construction step and judge its rendered result against the current reconstruction.
- Short-lived `codex exec` workers run with fast mode, no subagents, no inherited user providers, and only the native type contract available to designers.
- Figmaboy validates candidate operations itself and binds the resulting receipt to the exact render, rather than trusting the model to perform validation.

### Fixed

- Evolve worker process trees and temporary files are removed after every pass, cancellation, and failure.
- Empty, malformed, oversized, and canvas-rejected proposals receive bounded corrections with the exact validation error instead of ending immediately or looping forever.
- Evolve activity follows the bottom of the Codex timeline while the user remains there.
- Right-clicking inside a selected parent frame keeps the parent selected and opens its context menu.
- The first double-click selects nested text as a movable and resizable layer. A second double-click enters text editing.

## 0.5.2, 2026-09-01

### Added

- `/evolve` now runs three isolated design hypotheses per generation, renders each proposal in a separate candidate document, and visually compares them before applying the strongest result to the live canvas.
- The Codex sidebar keeps a compact generation journal with each mandate, hypothesis, rendered preview, comparison, and winner.

### Changed

- Evolve designers may rewrite text, restructure descendants, create or delete layers, reparent content, and resize the selected frame. They cannot remove the target frame or edit nodes outside it.
- Large documents use a cached scene index for viewport culling, snapping, marquee selection, and drop targeting. Normal moves stay outside the reactive document until pointer release and store compact node-level undo history.
- The canvas retains content in the direction of travel, delays pruning after fast movement, and uses a bounded cache of frame previews outside the live editing zone.

### Fixed

- Evolve specialists no longer inherit unrelated MCP or app providers, leak ephemeral threads, or retry the same shared configuration and output-schema failures as if they were rejected designs.
- Large canvases avoid repeated full-tree geometry scans during drags and no longer expose blank regions while destination content mounts.

## 0.5.1, 2026-09-01

### Changed

- Evolve designers now read the complete native TypeScript contract through a read-only `types_get` tool before proposing changes. No canvas-writing MCP tools are available to these agents.
- Invalid evolve proposals return the exact parser or canvas validation error to the same designer for correction instead of discarding the pass or repeating it with a new agent.

### Fixed

- Fast canvas panning and scrolling retain the previous render window until destination layers mount, preventing large documents from briefly turning blank.
- Evolve rejects malformed JSON, non-finite numeric properties, and invalid effect fields before visual comparison, then gives the designer enough information to repair them.

## 0.5.0, 2026-08-31

### Added

- `/evolve` runs independent design direction and editing passes against one selected frame. Accepted candidates appear on the canvas while the loop works, and one undo restores the starting design.
- The Codex composer supports inline skills, Markdown, pasted or dropped image references, and copying prompts from chat history.
- Frames can open in a focused fullscreen preview from the canvas or Layers context menu.

### Changed

- Design controls and Codex now share one right sidebar with stable width and direct tabs.
- Codex activity explains the current evolve pass, retries timed-out specialist work, and preserves `/evolve` threads in chat history.
- The built-in Codex tab loads the bundled Figmaboy MCP without setup prompts or global registration.
- Editor navigation uses a visible Back button. Home and editor transitions no longer show temporary branding or loading indicators.
- The landing page, screenshots, download page, README, and documentation now match the current desktop interface.

### Fixed

- Pasting images into the Tauri composer now uses binary clipboard data correctly.
- Text keeps its position and typography when entering or leaving edit mode.
- Home scrolling, page startup, sidebar resizing, and canvas selection avoid several unnecessary updates and layout stalls.
- Skill mentions remain styled where the user typed them and no longer duplicate the submitted message.

## 0.4.0, 2026-08-30

- Replaced the embedded terminal with a native Codex app-server sidebar.
- Added persistent per-design chats, streaming tool activity, approvals, image attachments, model controls, and local context tracking.
