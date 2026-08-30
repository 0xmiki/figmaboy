---
title: Quickstart
description: Build and refine your first native Figmaboy interface with Codex.
---

This walkthrough creates a small interface and checks the result with a screenshot. Every element remains editable.

## 1. Create a design

After completing [Install and connect](../install/), launch Figmaboy and choose **New design**. Rename the file to something easy to reference, such as `Radio concept`.

## 2. Open Codex inside the editor

Press <kbd>Ctrl</kbd> + <kbd>`</kbd> or select the chat button in the bottom toolbar. The Codex sidebar connects to `codex app-server`, loads chats saved for this design, and keeps the composer beside the canvas.

Use the searchable model control at the bottom of the composer to choose a model. The adjacent settings control shows only reasoning levels and service tiers supported by that model. Choices and unsent drafts persist for each design.

## 3. Tell Codex to use Figmaboy

The integrated sidebar automatically connects the bundled Figmaboy MCP server and tells Codex which design is open. Name the page or selection when the request could apply to more than one part of the file.

For a live edit, start with:

> Use Figmaboy to inspect and edit the currently open design page.

For a saved design that may not be open, use its copied ID or unique name:

> Use my saved Figmaboy design named "Radio concept" as context for this implementation. Inspect its preview and native layers before writing code.

A request such as "make a radio app" could mean editing the design or writing application code. Naming Figmaboy removes that ambiguity.

## 4. Give one clear design instruction

Paste a prompt like this:

> Build a 390 × 844 mobile radio player in the current Figmaboy page. Use a warm ivory canvas, near-black surfaces, and one signal-red accent. Include a frequency display, five station presets, playback controls, and bottom navigation. Create named semantic groups, keep every visible element native and editable, review the completed frame with a screenshot, then save it.

A useful request includes:

- The target screen size and platform.
- Visual direction, palette, and hierarchy.
- Required sections or states.
- The requirement to use native editable layers.
- A visual review and save step.

## 5. Watch the layer tree

Codex should inspect `design_capabilities` and the open document before editing. New sections should appear as named frames or groups, not as a flat list of layers.

One MCP operation batch becomes one undo step. Press <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>Z</kbd> if you want to revert the pass.

## 6. Refine instead of restarting

Point to the part that needs work:

> Keep the overall structure. Make the preset cards more compact, increase the contrast of secondary labels, and center the playback group inside its parent. Review the frame again and save.

You can also select a layer first and tell Codex to inspect the current selection.

The composer recognizes `@selection`, `@current-frame`, `@page`, and `@design`. Drop or paste a PNG, JPEG, or WebP into the sidebar to include it as a visual reference. Type `$` for installed skills or `/` for chat actions. While Codex is working, type another instruction and send it to steer the active turn.

## 7. Continue by hand

Close the Codex sidebar to return to the inspector for exact styling. Codex creates normal Figmaboy nodes, so you can switch between manual edits and chat at any time.

Next, learn the [canvas and layer model](../../core-concepts/canvas-and-layers/) or follow the complete [Build with Codex workflow](../../workflows/build-with-codex/).
