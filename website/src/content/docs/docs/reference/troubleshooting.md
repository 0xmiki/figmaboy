---
title: Troubleshooting
description: Diagnose MCP registration, offline context, live editor access, Linux libraries, macOS security, and Windows warnings.
---

## Codex does not show Figmaboy tools

Check the registration and the exact executable Codex will launch:

```bash
codex mcp get figmaboy
```

If the configured path points to an old repository or no longer exists:

```bash
codex mcp remove figmaboy
codex mcp add figmaboy -- "/absolute/path/to/figmaboy-mcp"
```

Start a new Codex session after changing MCP configuration.

## `figmaboy-mcp` is not found

Linux package users can check:

```bash
command -v figmaboy-mcp
```

AppImage users should install the standalone release binary at a stable path. macOS DMG and Windows installer users should first locate the MCP executable bundled with the installed app; a standalone release binary is available as a fallback. Follow the complete [Install and connect](../../getting-started/install/) steps for your platform.

## No saved workspace was found

Launch Figmaboy once and create or open a design. The app creates `figmaboy.sqlite3` in its platform data directory.

If you intentionally use a portable or nonstandard database, set `FIGMABOY_DB_PATH` for the MCP process to its absolute path.

## A design name is ambiguous

Two active files have the same name. Use the returned project names to identify the right file, copy its stable design ID from Figmaboy, and retry with `file_…`.

## Offline context has no preview

The native document and layer tree are still available. Open the page in Figmaboy, allow autosave to finish, and make a visible change if necessary so a fresh per-page preview is stored.

## Live tools say the editor is unavailable

Live tools require:

1. Figmaboy to be running.
2. A design page to be open in the editor.
3. The MCP and desktop app to use the same user account and application-data directory.

If `FIGMABOY_BRIDGE_FILE` is set, confirm it points to the current discovery file or remove the override.

## An edit was rejected because the document changed

This is optimistic-concurrency protection. You or another operation changed the page after Codex inspected it. Ask Codex to fetch `document_get` again and apply a new scoped operation using the latest change token.

## Linux cannot load `libgdk-3.so.0`

The executable is running without its GTK/WebKit runtime libraries. Use the distro package rather than launching an unwrapped Tauri binary. On NixOS, ensure the package wraps Figmaboy with the required GTK, WebKitGTK, and related library paths; a raw binary copied from `target/release` is not sufficient.

## macOS blocks the app or MCP server

Current builds are ad-hoc signed and not notarized. Confirm the download and checksum came from the official release, then approve the blocked item in **System Settings → Privacy & Security**.

## Windows SmartScreen appears

Current builds are not code-signed. Download only from the official GitHub release and compare the SHA-256 hash with `SHA256SUMS` before choosing to run it.

## Report a reproducible problem

[Open a GitHub issue](https://github.com/0xmiki/figmaboy/issues) with your OS, Figmaboy version, install type, the relevant MCP error, and the smallest steps that reproduce it. Do not include the authentication token from `editor-bridge.json`.
