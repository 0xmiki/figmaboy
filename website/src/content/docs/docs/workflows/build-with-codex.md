---
title: Build with Codex
description: Turn a product brief into a native Figmaboy design, then inspect and refine the result.
---

Build the structure first. Then inspect a screenshot and fix the problems you can see. Codex produces better edits when each pass has a clear scope.

## Make the target explicit

The Figmaboy sidebar connects the open design automatically. Identify the target page, frame, or selection in your instruction:

- For live work: "Use Figmaboy to edit the currently open page."
- For offline context: "Use the saved Figmaboy design named **[name]** as context."
- For an exact lookup: "Use the Figmaboy design with ID **[design ID]** as context."

This distinguishes a Figmaboy design task from a request to create or edit code directly in the current directory.

## Before the first prompt

1. Open the target design and page.
2. Open the Codex sidebar from the bottom toolbar.
3. Decide the screen size, content, visual direction, and important states.
4. Preserve any existing layers that should remain untouched by saying so explicitly.

## Request a structured first pass

Use this prompt template:

> In the current Figmaboy page, build a **[width × height] [screen type]** for **[product and user]**. Include **[required sections]**. Use **[visual direction, palette, and typography]**. Build one top-level screen frame with named section and component containers. Keep all interface elements native and editable. Inspect Figmaboy's capabilities and current document before editing. Review the completed frame, fix spacing, clipping, contrast, or alignment problems, and save.

For an existing design, add:

> Preserve **[specific frames or visual decisions]** and change only **[scope]**.

## Ask for evidence

Use `frame_screenshot` after each structure or styling pass. Give Codex this completion condition:

> Do not stop after creating the layers. Capture the complete frame, inspect spacing, clipping, contrast, hierarchy, and alignment, then make a refinement pass before saving.

## Refine by symptom

Describe the visible problem and the scope:

- "The header feels crowded. Preserve its content but increase its internal spacing."
- "The cards are too visually equal. Strengthen the active state without changing their sizes."
- "The image clips the title at the mobile breakpoint. Keep the crop but protect the text area."
- "Rename generic groups and organize the page into semantic sections."

Avoid asking for a complete rebuild when only one section needs correction.

## Bring in generated artwork

For original raster artwork, ask Codex to generate or edit the asset, save the final PNG, JPEG, or WebP in the active project, and call `image_place`.

For a background image, it should use the containing frame as `parentId`, `placement: "fill-parent"`, `fit: "cover"`, and `index: 0`. For a logo or cutout, use a transparent PNG with natural placement and explicit dimensions.

## Finish the pass

Before accepting the result, confirm that Codex:

- Used named frames and groups rather than a flat root list.
- Kept child coordinates local to their parents.
- Reviewed a complete screenshot.
- Saved the document.
- Left no accidental off-canvas or clipped nodes.
