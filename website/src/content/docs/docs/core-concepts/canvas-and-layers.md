---
title: Canvas and native layers
description: Understand frames, groups, coordinates, styling, and the semantic layer structure Codex should create.
---

Figmaboy stores designs as native document nodes. The canvas renders those nodes directly, and the MCP uses the same records when it inspects or edits an open page.

## Node types

The current document model supports:

- Containers include frames and groups.
- Shapes include rectangles, ellipses, lines, arrows, polygons, and stars.
- Content nodes include text, images, and icons.

Frames can provide a visible fill and clipping boundary. Groups organize a structural cluster without adding their own visual surface.

## Semantic hierarchy

A maintainable screen should resemble this:

```text
Radio app · Frame
├── Header · Group
│   ├── Product mark · Group
│   └── Menu button · Frame
├── Now tuning · Frame
│   ├── Live badge · Frame
│   ├── Frequency · Text
│   └── Tuner · Group
├── Presets · Group
│   ├── Station 01 · Frame
│   └── Station 02 · Frame
└── Bottom navigation · Frame
```

Use one top-level frame per screen. Add named section containers beneath it, then named components inside each section. Codex can act on a request such as "tighten the preset cards" without guessing which layers you mean.

## Coordinates

Child `x` and `y` values are local to their parent. Moving a section frame therefore moves all of its children without rewriting their internal layout.

The MCP's `geometry_get` tool can return local, world, canvas-client, and rotated-corner geometry when exact placement matters.

## Styling

Native layers support:

- Solid, linear-gradient, and radial-gradient fills.
- Strokes with width, opacity, dash, cap, and join controls.
- Uniform or independent corner radii.
- Blend modes, layered drop shadows, and blur.
- Typography including family, weight, italic, case, decoration, alignment, resizing, paragraph spacing, indentation, and truncation.

Codex can place generated PNG, JPEG, or WebP artwork as an image layer. You can move, resize, reorder, and replace that layer. The pixels inside it are not individually editable.

## Selection and nesting

Press <kbd>Enter</kbd> to move from a selected container to its first child. Press <kbd>Shift</kbd> + <kbd>Enter</kbd> to select the parent. Use the Layers panel for explicit nesting and reorder operations.

See [Keyboard shortcuts](../../reference/shortcuts/) for the full reference.
