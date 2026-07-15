---
title: Quickstart
description: Build and refine your first native Figmaboy interface with Codex.
---

This walkthrough creates a small interface, reviews it visually, and leaves every element editable.

## 1. Create a design

After completing [Install and connect](../install/), launch Figmaboy and choose **New design**. Rename the file to something easy to reference, such as `Radio concept`.

## 2. Open Codex inside the editor

Press <kbd>Ctrl</kbd> + <kbd>`</kbd> or select the terminal button in the bottom toolbar. Start Codex from the embedded shell:

```bash
codex
```

The shell starts in your home directory by default. Change into the project that should receive any exported assets or implementation code before starting Codex.

## 3. Tell Codex to use Figmaboy

Starting `codex` loads your registered MCP servers, but it does not automatically choose Figmaboy for every request. Name **Figmaboy** in your first instruction and say whether Codex should use the currently open page or a saved design.

For a live editing task, start with:

> Use Figmaboy to inspect and edit the currently open design page.

For a saved design that may not be open, use its copied ID or unique name:

> Use my saved Figmaboy design named “Radio concept” as context for this implementation. Inspect its preview and native layers before writing code.

This makes your intent unambiguous. A request such as “make a radio app” could otherwise mean creating application code instead of editing a Figmaboy design.

## 4. Give one clear design instruction

Paste a prompt like this:

> Build a 390 × 844 mobile radio player in the current Figmaboy page. Use a warm ivory canvas, near-black surfaces, and one signal-red accent. Include a frequency display, five station presets, playback controls, and bottom navigation. Create named semantic groups, keep every visible element native and editable, review the completed frame with a screenshot, then save it.

A useful request names:

- The target screen size and platform.
- Visual direction, palette, and hierarchy.
- Required sections or states.
- The requirement to use native editable layers.
- A visual review and save step.

## 5. Watch the layer tree

Codex should inspect `design_capabilities` and the open document before editing. New sections should appear as named frames or groups—not as a flat list of unrelated layers.

One MCP operation batch becomes one undo step. Press <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>Z</kbd> if you want to revert the pass.

## 6. Refine instead of restarting

Point to the part that needs work:

> Keep the overall structure. Make the preset cards more compact, increase the contrast of secondary labels, and center the playback group inside its parent. Review the frame again and save.

You can also select a layer first and tell Codex to inspect the current selection.

## 7. Continue by hand

Close or resize the terminal and use the inspector for exact styling. Codex changes are normal Figmaboy nodes, so manual and agent-driven editing can alternate freely.

Next, learn the [canvas and layer model](../../core-concepts/canvas-and-layers/) or follow the complete [Build with Codex workflow](../../workflows/build-with-codex/).
