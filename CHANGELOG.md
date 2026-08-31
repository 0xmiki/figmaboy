# Changelog

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
