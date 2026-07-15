---
title: Use a saved design offline
description: Let Codex inspect a saved Figmaboy design by copied ID or convenient file name while the app is closed.
---

Offline context turns a saved Figmaboy page into implementation reference: a visual preview plus the complete native layer tree and document data.

## Copy a stable design ID

In the workspace, right-click a design card and choose **Copy design ID**. Inside the editor, use the copy button beside the file name.

IDs look like `file_…` and remain stable when the file is renamed. Prefer an ID for important or automated work:

> Build the dashboard from Figmaboy design `file_…`, page `Overview`. Use its preview and native layer tree as the visual and layout reference.

## Reference a convenient name

Unique names work too:

> Use the saved Figmaboy design named `Marketing site`, page `Home`, as implementation context.

Name lookup is case-insensitive. If multiple active designs have the same name, Codex receives the matching project names and IDs and must retry with an exact ID.

## What Codex receives

`design_context_get` returns:

- The resolved file and page IDs and names.
- All pages and their latest saved revisions.
- The chosen page's complete native document.
- An ordered layer tree for quick structural reading.
- Asset metadata used by the document.
- A visual preview when the page has been rendered and autosaved.

This is enough to reason about dimensions, spacing, colors, type, hierarchy, content, and component boundaries without the app running.

## Read-only means read-only

Offline tools never write to the workspace. If you ask Codex to change a design while Figmaboy is closed, it should explain that live editing requires the desktop app and the target design to be open.

## Implementation prompt

For a strong handoff from design to code:

> Load Figmaboy design `file_…`, page `Checkout`. First summarize its screen size, section hierarchy, reusable components, type scale, colors, spacing rhythm, and assets. Then inspect this repository's existing framework and conventions. Implement the page responsively, preserving the design's visual hierarchy and content. Use the Figmaboy preview for visual comparison and the native layers for exact structure.

Ask Codex to take browser screenshots of the implementation and compare them with the returned Figmaboy preview when browser tools are available.
