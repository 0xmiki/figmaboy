---
title: Evolve a frame
description: Repeatedly improve one frame toward a visual direction while accepted work stays visible on the canvas.
---

Select one frame, then give `/evolve` a visual direction:

```text
/evolve Strengthen the hierarchy and make the primary action easier to find
```

Figmaboy reviews the frame, applies a candidate on the canvas, compares it with the current best, and continues from the stronger result.

## What happens during a pass

1. Figmaboy captures the selected frame and its native layers.
2. A design review identifies the next useful change.
3. A candidate is applied directly on the canvas.
4. A fresh comparison keeps or rejects the candidate.
5. Accepted changes remain visible while the next pass begins.

The loop finishes when two independent reviews agree that the requested direction has been reached. It has no fixed pass count. Select **Stop** whenever you want to keep the accepted progress and finish early.

## What stays safe

- Rejected candidates restore the current best version.
- A temporary network failure retries the current stage instead of restarting the run.
- Accepted passes form one undoable Figmaboy change. Press <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> once to return to the design from before `/evolve`.
- Text, image assets, crops, locked layers, and the selected frame bounds remain protected.

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

The Codex tab shows the active stage, the current target, and whether each candidate was kept or discarded. Canvas changes are live, so you can judge progress without opening logs.

Do not edit the selected frame while a candidate is being compared. If the document changes, Figmaboy rejects the stale candidate and inspects the current frame again.
