---
title: Create your first design
description: Open a design, ask Codex to build an editable screen, and review the result on the canvas.
---

## 1. Create a design

Launch Figmaboy and choose **New design**. Give the file a name that will still make sense in your recent designs.

## 2. Open Codex

Select **Codex** in the right sidebar. You can also press <kbd>Ctrl</kbd> + <kbd>`</kbd>.

The built-in chat starts Codex app-server and supplies the bundled Figmaboy tools automatically. No MCP registration is required.

Choose a model and reasoning level at the bottom of the composer when you want to change the defaults.

## 3. Describe the screen

Give Codex the target size, required content, and visual direction:

> Build a 390 × 844 mobile radio player in the current page. Use a warm ivory canvas, near-black surfaces, and one signal-red accent. Include a frequency display, five station presets, playback controls, and bottom navigation. Keep every visible element native and editable. Review the completed frame, fix visible spacing or clipping problems, then save it.

Codex inspects the document before editing. New frames and layers appear in the layer tree while it works.

## 4. Judge the result

Inspect the finished frame on the canvas. Every Codex edit uses normal Figmaboy history, so <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> reverts it.

For a focused correction, select a layer or frame and describe the problem:

> Keep the structure. Make the station cards more compact and give the active station a clearer state.

## 5. Evolve the direction when one pass is not enough

Select one frame and run:

```text
/evolve Make this dashboard easier to scan with a clearer hierarchy and less visual noise
```

Figmaboy applies candidates on the canvas and keeps the stronger result. Read [Evolve a frame](../../workflows/evolve/) for the loop, Stop behavior, and undo boundary.

## Composer shortcuts

- Type `@selection`, `@current-frame`, `@page`, or `@design` to identify scope.
- Type `$` to add an installed Codex skill inline.
- Paste or drop a PNG, JPEG, or WebP as a visual reference.
- Send another message while Codex works to steer the active turn.
- Type `/` for `/review`, `/evolve`, `/save`, `/compact`, and `/undo`.

Continue with [Chat beside the canvas](../../workflows/build-with-codex/) or learn the [canvas and layer model](../../core-concepts/canvas-and-layers/).
