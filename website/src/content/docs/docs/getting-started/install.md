---
title: Install and connect
description: Install Figmaboy, open its built-in Codex chat, and let Codex handle optional MCP setup.
---

[Download Figmaboy for your platform](../../../download/)

## Let Codex handle the MCP setup

The chat inside Figmaboy needs no MCP registration. Install the [Codex CLI](https://developers.openai.com/codex/cli/), sign in once, open a design, and select the sparkle button. Figmaboy starts the bundled MCP server for that chat.

If you also want Figmaboy tools in Codex CLI, the IDE extension, or the ChatGPT desktop app, ask Codex to set them up:

```text
Open https://raw.githubusercontent.com/0xmiki/figmaboy/main/docs/INSTALL_FIGMABOY_MCP.md and follow it to install or repair the Figmaboy MCP for this computer. Verify the checksum before running a downloaded binary. Keep any working custom registration.
```

Already inside Figmaboy? Type this in the chat composer:

```text
/install-mcp
```

Figmaboy checks the saved Codex configuration, repairs a missing executable, and leaves a working custom entry alone. Start a new external Codex session after it finishes.

That is the recommended setup. The commands are available under [Manual MCP installation](#manual-mcp-installation) if you need to inspect or repair the configuration yourself.

## Install the desktop app

Figmaboy installers contain the desktop app and its matching `figmaboy-mcp` server. The AppImage is different. Its internal sidecar path changes each time it mounts, so external Codex clients need the standalone MCP release asset at a stable path.

### Debian or Ubuntu

Download the `.deb` file, then install it:

```bash
cd ~/Downloads
sudo apt install ./Figmaboy_*_amd64.deb
```

Launch Figmaboy from the application menu or run `figmaboy`.

### Fedora or RHEL

Download the `.rpm` file, then install it:

```bash
cd ~/Downloads
sudo dnf install ./Figmaboy_*_x86_64.rpm
```

### AppImage and other Linux distributions

Download `Figmaboy_*.AppImage`, make it executable, and run it:

```bash
chmod +x ~/Downloads/Figmaboy_*.AppImage
~/Downloads/Figmaboy_*.AppImage
```

If you want Figmaboy in external Codex clients, let Codex download and register the matching standalone MCP asset with the prompt above.

### NixOS

Run the AppImage with `appimage-run`:

```bash
appimage-run ~/Downloads/Figmaboy_*.AppImage
```

A native derivation should expose `figmaboy` and `figmaboy-mcp` in the same profile. Add it to `environment.systemPackages` or Home Manager, rebuild, then use the Codex setup prompt above.

### macOS

Choose the DMG for your processor:

| Mac | Check with | Download |
| --- | --- | --- |
| Apple Silicon | `uname -m` prints `arm64` | `aarch64` DMG |
| Intel | `uname -m` prints `x86_64` | `x86_64` DMG |

Open the DMG and drag **Figmaboy** into **Applications**.

The builds are ad hoc signed but not notarized. If macOS blocks the first launch, verify the release checksum, then approve Figmaboy in **System Settings > Privacy & Security**.

### Windows

Download and run the NSIS `.exe` installer or the MSI package. Both include `figmaboy-mcp.exe` beside the installed desktop app.

Current Windows builds are not code-signed and may trigger SmartScreen. Download only from the official GitHub release and compare the SHA-256 hash with `SHA256SUMS` before running the installer.

## Test the connection

For the built-in chat, open a design and ask:

> Inspect the current Figmaboy page and summarize its layer structure. Do not change it.

For an external Codex client, start a new session and ask:

> List my saved Figmaboy designs.

Saved-design tools work while Figmaboy is closed. Screenshots, live inspection, and edits need the desktop app open with a design loaded.

## Update Figmaboy

Package managers and desktop installers keep the MCP executable at the same path, so Codex registration usually survives an update. AppImage and standalone users should replace the binary at its existing stable path instead of moving it.

Run `/install-mcp` again if an update moved or removed the executable.

## Verify release checksums

Every release includes `SHA256SUMS`.

On Linux:

```bash
cd ~/Downloads
sha256sum --ignore-missing --check SHA256SUMS
```

On macOS, run `shasum -a 256 <filename>` and compare the result with the matching line in `SHA256SUMS`.

On Windows PowerShell:

```powershell
Get-FileHash .\Figmaboy_*.exe -Algorithm SHA256
Get-FileHash .\figmaboy-mcp-*.exe -Algorithm SHA256
```

## Manual MCP installation

<details>
<summary>Show platform paths and registration commands</summary>

Use this only when the Codex-led setup cannot run.

First inspect the current entry:

```bash
codex mcp get figmaboy --json
```

Keep it if its command still works. Remove it only when the executable is missing:

```bash
codex mcp remove figmaboy
```

Find the stable executable installed with Figmaboy:

| Installation | Stable MCP path |
| --- | --- |
| Linux `.deb` or `.rpm` | `/usr/bin/figmaboy-mcp` |
| Linux AppImage or standalone | `~/.local/bin/figmaboy-mcp` |
| Native Nix package | The profile path from `command -v figmaboy-mcp` |
| macOS Applications | `/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp` |
| macOS user Applications | `~/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp` |
| Windows NSIS | `%LOCALAPPDATA%\Figmaboy\figmaboy-mcp.exe` |
| Windows MSI | `%ProgramFiles%\Figmaboy\figmaboy-mcp.exe` |
| Windows standalone | `%LOCALAPPDATA%\Figmaboy\bin\figmaboy-mcp.exe` |

On Linux or macOS, verify and register the absolute path:

```bash
MCP_BIN="/absolute/path/to/figmaboy-mcp"
test -x "$MCP_BIN"
"$MCP_BIN" --version
codex mcp add figmaboy -- "$MCP_BIN"
codex mcp get figmaboy --json
```

For AppImage users, download `figmaboy-mcp-x86_64-unknown-linux-gnu`, verify it against `SHA256SUMS`, then put it at a stable path before registration:

```bash
mkdir -p ~/.local/bin
install -m 755 \
  ~/Downloads/figmaboy-mcp-x86_64-unknown-linux-gnu \
  ~/.local/bin/figmaboy-mcp
```

For a standalone macOS fallback, use `figmaboy-mcp-aarch64-apple-darwin` on Apple Silicon or `figmaboy-mcp-x86_64-apple-darwin` on Intel. Install it as `~/.local/bin/figmaboy-mcp`.

On Windows PowerShell, locate the bundled executable and register it:

```powershell
$SearchRoots = @(
  (Join-Path $env:LOCALAPPDATA "Figmaboy")
  (Join-Path $env:ProgramFiles "Figmaboy")
)

$McpBin = Get-ChildItem -Path $SearchRoots -Filter "figmaboy-mcp.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

if (-not $McpBin) {
  throw "figmaboy-mcp.exe was not found."
}

& $McpBin --version
codex mcp add figmaboy -- "$McpBin"
codex mcp get figmaboy --json
```

If Windows has no bundled executable, download `figmaboy-mcp-x86_64-pc-windows-msvc.exe`, verify its checksum, and save it as `%LOCALAPPDATA%\Figmaboy\bin\figmaboy-mcp.exe` before registration.

Do not register an AppImage mount, temporary directory, downloads folder, or repository build path. Start a new Codex session after registration.

</details>

Continue with the [Quickstart](../quickstart/).
