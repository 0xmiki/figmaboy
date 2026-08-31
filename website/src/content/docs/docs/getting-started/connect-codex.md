---
title: Use Figmaboy from other Codex clients
description: Understand when an external Codex client needs the standalone Figmaboy MCP.
---

You probably do not need this page. The Codex tab inside Figmaboy receives its design tools automatically. Open a design and start chatting.

Install the standalone Figmaboy MCP only when you want Codex outside Figmaboy, such as Codex CLI or an IDE integration, to:

- Read saved Figmaboy designs.
- Inspect the design currently open in the desktop app.
- Edit that open design through Figmaboy's normal history and autosave.

External MCP installation changes your Codex configuration and only affects new external Codex sessions. Figmaboy does not request or perform that setup during normal use.

## What works after external setup

Saved-design reads work while Figmaboy is closed. Screenshots, live inspection, and edits require Figmaboy to be open with a design loaded.

Use the standalone MCP asset from the same Figmaboy release and follow the MCP installation flow provided by your external Codex client. The desktop app does not show installation commands because none are needed for its built-in Codex tab.

## Check the external connection

In a new external Codex session, ask:

> List my saved Figmaboy designs.

With Figmaboy open on a design, ask:

> Inspect the current Figmaboy page and summarize its frame and layer structure. Do not change it.

If those tools are unavailable, check the MCP settings in that external client and confirm it points to the standalone binary from your installed Figmaboy version.
