---
title: Release notes
description: What changed in the current Figmaboy release.
---

## Figmaboy 0.5.5

Released September 3, 2026.

### Reconstruct, then inspect

`/evolve` now treats the selected frame as a frozen reference and constructs a new interpretation inside an empty sibling frame. The designer must invent a new information architecture and composition instead of tracing or restyling the source component tree.

Figmaboy renders every proposal in an isolated candidate canvas. A dedicated visual reviewer receives the reference, current reconstruction, exact candidate image, and deterministic audit before the director compares or commits the work. Passes may use as many operations and layers as their objective requires.

### Better design evidence

Evolution designers can inspect frame screenshots, search the Phosphor icon catalog, review reusable image assets, check available fonts, and audit clipping, text overflow, contrast, and target size. Read-only MCP tools now publish the matching machine-readable metadata.

### Quieter built-in Codex

Figmaboy chat history now stays in Figmaboy instead of appearing in the main Codex history. The bundled design tools are trusted inside the app, so reading or editing the open canvas no longer opens a permission prompt. Filesystem, shell, network, and external-tool protections remain unchanged.

## Figmaboy 0.5.4

Released September 3, 2026.

### Meet Shape Boy

Shape Boy is now the Figmaboy mark. The square eye, circular eye, and curved path use the same basic forms available on the canvas. The new mark appears in the desktop app, platform installers, website, documentation, and repository.

### One website

The new landing page now lives at the main Figmaboy URL. Its product preview reconstructs the real editor proportions, Codex sidebar, composer, Phosphor controls, and Sonic 60 design instead of showing a generated product image.

The documentation and download page now use the same type, color, spacing, navigation, and button system. Platform detection and direct release links continue to work on the download page.

## Figmaboy 0.5.3

Released September 2, 2026.

### Reconstruct from first principles

`/evolve` now leaves the selected frame untouched and creates an empty sibling frame beside it. The original remains a frozen reference for content, assets, dimensions, and product intent while Figmaboy constructs a new interpretation for the requested direction.

Each pass follows one visible objective. The director names its completion condition, the designer uses the operations and layers needed to build it, and accepted work appears on the reconstruction before the next pass begins.

### A smaller and safer evolve runtime

One sequential designer replaces the parallel candidate tournament. Every director, designer, and correction runs in a short-lived `codex exec` worker with subagents and unrelated providers disabled. Figmaboy owns validation, rendering, cancellation, and process cleanup.

Empty, malformed, and canvas-rejected proposals receive the exact error and a bounded correction opportunity. Persistent failures stop cleanly instead of producing an endless correction loop. The best completed reconstruction remains on the canvas after Stop or an error.

### Editor interaction fixes

- The evolution journal follows new activity while you remain at the bottom of the Codex timeline.
- Right-clicking a child inside a selected parent frame opens the menu for the parent without changing selection.
- The first double-click selects nested text as a normal movable and resizable layer. Double-click the selected text again to edit it.

## Figmaboy 0.5.2

Released September 1, 2026.

### Parallel design evolution

Each `/evolve` generation now gives three isolated designers different search mandates. Figmaboy renders their proposals in separate candidate documents, compares the results visually, and applies the strongest one to the open canvas. The Codex sidebar preserves a compact journal of the mandates, hypotheses, previews, comparisons, and winners.

Designers may rewrite text and restructure anything inside the selected frame. The target frame remains present, and nodes outside it remain untouched.

### Faster large documents

The canvas uses indexed geometry instead of scanning every layer for culling, snapping, marquee selection, and drop targeting. Normal drags move through a temporary interaction layer and update the document once on release. Nearby complex frames may use bounded cached previews, while selected and edited content remains live.

### Safer specialist runs

Evolve threads start with only the tools they need and are deleted after use. Shared configuration or output-schema failures stop with the actual error instead of sending every designer through the same correction loop.

## Figmaboy 0.5.1

Released September 1, 2026.

### More reliable evolve passes

Evolve designers read Figmaboy's complete native type contract before proposing a change. Their only Figmaboy tool is the read-only contract lookup. If a proposal fails parsing or canvas validation, Figmaboy sends the exact error back to the same designer for correction.

### Canvas rendering fix

Large documents keep the previous render window mounted until layers in the new viewport are ready. Fast panning and scrolling no longer expose a blank canvas while off-screen layers remount.

## Figmaboy 0.5.0

Released August 31, 2026.

### Evolve a selected frame

`/evolve` runs independent design direction and editing passes against one selected frame. Each accepted candidate appears on the canvas while the loop works. One undo returns to the design from before the run.

[Learn how to evolve a frame](../../workflows/evolve/)

### A better Codex workspace

- Skills stay styled where you type them.
- The composer accepts pasted and dropped image references.
- User prompts can be copied from chat history.
- Design controls and Codex share one stable right sidebar.
- Evolve activity explains the current pass and retries timed-out specialist work.

The built-in Codex tab loads Figmaboy's design tools automatically. It does not ask you to install or register an MCP server.

### Editor changes

- Open a frame in fullscreen from the canvas or Layers context menu.
- Use the visible Back button to return to projects.
- Home and editor transitions no longer show temporary loading artwork.
- Text keeps its position and typography when edit mode changes.
- Page startup, home scrolling, sidebar resizing, and canvas selection do less unnecessary work.

Read the complete repository history in the [changelog](https://github.com/0xmiki/figmaboy/blob/main/CHANGELOG.md).
