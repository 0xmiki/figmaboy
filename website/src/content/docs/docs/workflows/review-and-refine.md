---
title: Review and refine
description: Use screenshots, selections, geometry, undo, and scoped prompts to improve a Figmaboy design safely.
---

Treat a Codex-generated screen as a design pass, not an unquestionable final answer. Visual review catches problems that a valid layer tree cannot.

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

Clear layer names make this much safer. If the tree contains names like `Group 24`, ask Codex to rename and organize it before a long series of refinements.

## Use history

One atomic `operations_apply` batch becomes one undo step. Use the normal keyboard shortcut or ask Codex to call `history_undo`. `history_redo` restores the undone MCP mutation.

If you edit manually while Codex is working, change-token validation can reject its stale operation. That is expected protection: Codex should inspect the document again and reapply only the still-needed edits.

## Save the accepted state

Ask Codex to call `document_save` after the last review pass. The response includes the database revision and save state, giving you a clear completion boundary.
