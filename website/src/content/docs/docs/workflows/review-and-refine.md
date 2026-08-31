---
title: Review and refine
description: Use screenshots, selections, geometry, undo, and scoped prompts to improve a Figmaboy design safely.
---

A valid layer tree can still look wrong. Review every Codex-generated screen before accepting it.

## Review the complete frame

Ask Codex to call `frame_screenshot` for each finished top-level screen. Review:

- Layout hierarchy and balance.
- Consistent outer margins and internal spacing.
- Text wrapping, truncation, and contrast.
- Image crop and clipping.
- Alignment of repeated controls.
- Active, disabled, and selected states.
- Whether decorative elements compete with primary content.

## Inspect exact geometry

When an alignment issue is subtle, select the affected layers and ask Codex to use `geometry_get`. Use `nodes_center` for exact horizontal or vertical centering instead of hand-computed offsets.

## Scope changes by layer or section

Name the target and preserve everything else:

> In the `Pricing cards` group only, align the price baselines, make the middle card the clear recommended state, and preserve all copy and outer section geometry. Review the full page afterward.

Clear layer names reduce accidental edits. If the tree contains names such as `Group 24`, ask Codex to rename and organize it before further work.

## Use history

One atomic `operations_apply` batch becomes one undo step. Use the normal keyboard shortcut or ask Codex to call `history_undo`. `history_redo` restores the undone MCP mutation.

If you edit manually while Codex is working, change-token validation may reject its stale operation. Codex should inspect the document again and apply only the edits that are still needed.

## Save the accepted state

Ask Codex to call `document_save` after the last review pass. The response includes the database revision and save state, giving you a clear completion boundary.

## Choose one review or an evolution loop

Use `/review` for one inspection and correction pass. Use [`/evolve [direction]`](./evolve/) when one selected frame needs repeated visual exploration toward a named direction.
