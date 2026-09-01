---
title: Release notes
description: What changed in the current Figmaboy release.
---

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
