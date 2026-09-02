---
title: Evolve a frame
description: Reconstruct a selected frame from first principles while the original remains visible as a frozen reference.
---

Select one frame, then give `/evolve` a visual direction:

```text
/evolve Strengthen the hierarchy and make the primary action easier to find
```

Figmaboy leaves the selected frame untouched and creates an empty frame of the same size beside it. The original supplies exact content, assets, dimensions, and product intent. A director and designer then construct a new interpretation for your requested direction.

## What happens during a pass

1. Figmaboy freezes the selected frame as the reference.
2. It creates and selects an empty sibling frame named as an evolution draft.
3. A director chooses one small construction objective with a visible completion condition.
4. One designer builds that pass inside an isolated candidate document. A pass may contain at most five operations and four new layers.
5. The director compares the proposal with the current reconstruction and its objective.
6. An accepted pass appears on the sibling frame and becomes the base for the next pass.

The loop finishes when two independent reviews agree that the requested direction has been reached. It has no fixed pass count. Select **Stop** whenever you want to keep the accepted progress and finish early.

The per-pass budget is intentional. Think of the reconstruction as a painting built layer by layer. Each pass adds one region, component, or design decision, pauses for inspection, and leaves the next layer for later. You can watch the composition emerge while each review pays attention to local detail.

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
