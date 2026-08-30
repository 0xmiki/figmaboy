---
title: Let Codex connect Figmaboy
description: Give Codex one prompt and let it install or repair the Figmaboy MCP.
---

Figmaboy's built-in chat needs no MCP setup. It starts the bundled server whenever you open the sidebar.

Use this page when you want Figmaboy tools in Codex CLI, the IDE extension, or the ChatGPT desktop app.

## Ask Codex to do it

Paste this into Codex:

```text
Open https://raw.githubusercontent.com/0xmiki/figmaboy/main/docs/INSTALL_FIGMABOY_MCP.md and follow it to install or repair the Figmaboy MCP for this computer. Verify the checksum before running a downloaded binary. Keep any working custom registration.
```

Codex will inspect the current registration, detect the operating system, find the binary bundled with Figmaboy, and verify it before making changes. If the binary is missing, the guide tells Codex which release asset to download and where to keep it.

You approve any commands through the normal Codex permission flow. The guide tells Codex to keep a working custom entry and avoid temporary paths.

## Use the Figmaboy shortcut

If Figmaboy is already open, its sidebar can register the bundled binary directly. Type:

```text
/install-mcp
```

The shortcut repairs missing or stale registrations. It leaves working local and remote entries unchanged.

## Test it

Start a new Codex session, then ask:

> List my saved Figmaboy designs.

If Figmaboy is open with a design loaded, try:

> Inspect the current Figmaboy page and summarize its layer structure. Do not change it.

<details>
<summary>Manual installation</summary>

The [Install and connect](../install/#manual-mcp-installation) page lists stable platform paths and registration commands.

</details>
