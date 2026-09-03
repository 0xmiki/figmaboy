---
title: Evolve a frame
description: Reconstruct a selected frame from first principles while the original remains visible as a frozen reference.
---

Select one frame, then give `/evolve` a visual direction:

```text
/evolve Strengthen the hierarchy and make the primary action easier to find
```

Figmaboy leaves the selected frame untouched and creates an empty frame of the same size beside it. The original supplies content, assets, dimensions, and product intent. It does not supply a component template. A director and designer invent a new information architecture and composition for your requested direction.

The director keeps structural originality as an acceptance criterion throughout the run. It rejects cosmetic restyles and proposals that reproduce the source component tree, section order, card arrangement, navigation pattern, or overall silhouette. Figmaboy preserves source structure only when your direction explicitly asks for it.

The director also keeps design resolution as a fixed criterion. A request for minimalism may remove noise, but it cannot replace controls with placeholder-like labels and divider lines or stop before hierarchy, spacing, typography, and interaction states feel deliberate.

## What happens during a pass

1. Figmaboy freezes the selected frame as the reference.
2. It creates and selects an empty sibling frame named as an evolution draft.
3. A director chooses one small construction objective with a visible completion condition.
4. One designer builds that pass inside an isolated candidate document, using as many operations and layers as the objective requires.
5. The director compares the proposal with the current reconstruction, its objective, and the requirement to remain structurally distinct from the reference.
6. An accepted pass appears on the sibling frame and becomes the base for the next pass.

The loop finishes when two independent reviews agree that the requested direction has been reached. It has no fixed pass count. Select **Stop** whenever you want to keep the accepted progress and finish early.

Think of the reconstruction as a painting built layer by layer. Each pass follows one objective, pauses for inspection, and leaves unrelated work for later. This is direction rather than a fixed operation or layer limit: a coherent objective can use the full structure it needs.

Designers can search the Phosphor icon catalog, inspect reusable image assets and their previews, check available fonts, and run deterministic layout and accessibility checks. Figmaboy renders every complete proposal in an isolated candidate canvas and starts a dedicated visual-review turn with the reference, current reconstruction, exact candidate image, and audit. That reviewer can revise weak work before the director compares it or anything reaches the visible reconstruction.

## What stays safe

- The reference frame never changes during the run.
- Candidate documents are isolated, so rejected proposals never modify the visible reconstruction.
- A temporary network failure retries the current stage instead of restarting the run.
- If a proposal contains invalid native properties, Figmaboy sends the exact validation error and node contract back to the same designer for correction. The failed implementation does not count as a discarded visual candidate.
- Stop and network errors leave the best accepted reconstruction on the canvas.
- The designer may rewrite, resize, restyle, create, delete, and reparent content inside the reconstruction. It cannot edit the reference or anything outside the reconstruction frame.

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

The Codex tab shows each pass's objective, hypothesis, render status, and decision. The journal remains in the conversation after the run, while large screenshots are released from memory.

You may keep navigating the canvas while reconstruction runs. If you edit the reconstruction, Figmaboy uses your version as the next base. The frozen reference still reflects the frame as it appeared when the run began.
