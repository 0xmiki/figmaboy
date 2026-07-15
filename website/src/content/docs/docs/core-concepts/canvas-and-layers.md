---
title: Canvas and native layers
description: Understand frames, groups, coordinates, styling, and the semantic layer structure Codex should create.
---

Figmaboy stores designs as native document nodes. The canvas renders those nodes directly, and the MCP uses the same records when it inspects or edits an open page.

## Node types

The current document model supports:

- **Containers:** frames and groups.
- **Shapes:** rectangles, ellipses, lines, arrows, polygons, and stars.
- **Content:** text, images, and icons.

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

Use one top-level frame per screen, named section containers beneath it, and named component groups or frames within each section. This makes later instructions such as “tighten the preset cards” unambiguous.

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

For generated artwork, Codex can place a PNG, JPEG, or WebP as an image layer. The image remains a native addressable layer, although the pixels inside it are not individually editable.

## Selection and nesting

Press <kbd>Enter</kbd> to move from a selected container to its first child. Press <kbd>Shift</kbd> + <kbd>Enter</kbd> to select the parent. Use the Layers panel for explicit nesting and reorder operations.

See [Keyboard shortcuts](../../reference/shortcuts/) for the full reference.
