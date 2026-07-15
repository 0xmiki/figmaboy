---
title: Build with Codex
description: A repeatable workflow for turning a product brief into a polished native Figmaboy design.
---

Good Codex design work is iterative: establish structure, build a coherent pass, inspect visual evidence, then refine the specific problems you can see.

## Before the first prompt

1. Open the target design and page.
2. Change the embedded terminal into the implementation repository if the task may create assets or code.
3. Decide the screen size, content, visual direction, and important states.
4. Preserve any existing layers that should remain untouched by saying so explicitly.

## Request a structured first pass

Use this prompt template:

> In the current Figmaboy page, build a **[width × height] [screen type]** for **[product and user]**. Include **[required sections]**. Use **[visual direction, palette, and typography]**. Build one top-level screen frame with named section and component containers. Keep all interface elements native and editable. Inspect Figmaboy's capabilities and current document before editing, visually review the completed frame, fix obvious issues, and save.

For an existing design, add:

> Preserve **[specific frames or visual decisions]** and change only **[scope]**.

## Ask for evidence

The key review tool is `frame_screenshot`. Ask Codex to inspect the full frame after each meaningful pass. A useful completion condition is:

> Do not stop after creating the layers. Capture the complete frame, inspect spacing, clipping, contrast, hierarchy, and alignment, then make a refinement pass before saving.

## Refine by symptom

Concrete feedback produces safer edits:

- “The header feels crowded; preserve its content but increase its internal spacing.”
- “The cards are too visually equal; strengthen the active state without changing their sizes.”
- “The image is clipping the title at the mobile breakpoint; keep the crop but protect the text area.”
- “Rename generic groups and organize the page into semantic sections.”

Avoid asking for a complete rebuild when only one section needs correction.

## Bring in generated artwork

If original raster artwork would improve the interface, ask Codex to generate or edit the asset, save the final PNG/JPEG/WebP in the active project, and call `image_place`.

For a background image, it should use the containing frame as `parentId`, `placement: "fill-parent"`, `fit: "cover"`, and `index: 0`. For a logo or cutout, use a transparent PNG with natural placement and explicit dimensions.

## Finish deliberately

Before accepting the result, confirm that Codex:

- Used named frames and groups rather than a flat root list.
- Kept child coordinates local to their parents.
- Reviewed a complete screenshot.
- Saved the document.
- Left no accidental off-canvas or clipped nodes.
