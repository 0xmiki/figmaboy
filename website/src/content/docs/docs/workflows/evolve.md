---
title: Evolve a frame
description: Repeatedly improve one frame toward a visual direction while accepted work stays visible on the canvas.
---

Select one frame, then give `/evolve` a visual direction:

```text
/evolve Strengthen the hierarchy and make the primary action easier to find
```

Figmaboy freezes the requested direction, gives three isolated designers different ways to pursue it, renders each proposal away from the live document, and compares them with the current best. The strongest candidate becomes the starting point for the next generation.

## What happens during a pass

1. Figmaboy captures the selected frame and freezes clear criteria from your direction.
2. A design director creates three distinct search mandates for the generation.
3. Three designers independently form and implement their own hypotheses.
4. Figmaboy renders every proposal in an isolated candidate document.
5. Fresh visual comparisons select the strongest challenger.
6. The winner appears on the live canvas and becomes the base for the next generation.

The loop finishes when two independent reviews agree that the requested direction has been reached. It has no fixed pass count. Select **Stop** whenever you want to keep the accepted progress and finish early.

## What stays safe

- Candidate documents are isolated, so designers cannot overwrite one another or the live canvas while they work.
- Rejected candidates never modify the accepted design.
- A temporary network failure retries the current stage instead of restarting the run.
- If a proposal contains invalid native properties, Figmaboy sends the exact validation error and node contract back to the same designer for correction. The failed implementation does not count as a discarded visual candidate.
- Accepted passes form one undoable Figmaboy change. Press <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> once to return to the design from before `/evolve`.
- Designers may rewrite text, resize or restyle the target frame, create and delete descendants, and reparent content inside it. They cannot delete the target frame or touch nodes outside it.

## Give a direction, not a score

Useful directions describe the intended result:

```text
/evolve Make this onboarding flow feel simpler and more trustworthy
```

```text
/evolve Increase information density without making this dashboard harder to scan
```

```text
/evolve Give this storefront a warmer visual tone while preserving its content
```

Avoid prompts such as `make it better`. Name the character, hierarchy, density, or interaction quality that should change.

## During the run

The Codex tab shows each generation's mandates, hypotheses, render status, comparisons, and winner. The journal remains in the conversation after the run, while large screenshots are released from memory.

You may keep navigating the canvas while evolution runs. If you commit a design edit to the target frame, Figmaboy makes that version the next generation's base. A conflicting candidate must still win a fresh visual comparison before it can replace your edit.
