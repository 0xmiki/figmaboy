---
title: Install and connect
description: Install Figmaboy and register its bundled MCP server with Codex on Linux, NixOS, macOS, or Windows.
---

This page completes the whole setup for your platform: install the Figmaboy desktop app, locate or install `figmaboy-mcp`, register it with Codex, and verify the connection.

[Download Figmaboy for your platform](../../../download/)

## How the installation works

Figmaboy and its MCP server are separate executables:

- `figmaboy` is the desktop design app.
- `figmaboy-mcp` is the local stdio server that Codex launches when it needs Figmaboy tools.

The `.deb`, `.rpm`, DMG, MSI, and NSIS installers contain both executables. The AppImage also contains the sidecar, but its internal runtime path is temporary, so AppImage users should install the standalone MCP release asset at a stable path.

Installing the app does **not** automatically change your Codex configuration. You must register the MCP executable once with `codex mcp add`. Codex stores that registration in `~/.codex/config.toml`; the Codex CLI, IDE extension, and desktop app share it.

## Before you begin

Install the [Codex CLI](https://developers.openai.com/codex/cli/) and confirm that it runs:

```bash
codex --version
```

If you previously connected Figmaboy from a repository checkout or another installation, inspect the saved command:

```bash
codex mcp get figmaboy
```

If it points to an old or missing executable, remove it before following your platform steps:

```bash
codex mcp remove figmaboy
```

If Codex reports that no server named `figmaboy` exists, nothing needs to be removed.

## Linux

### Debian or Ubuntu (`.deb`)

1. Download the `.deb` file from the latest release.
2. Open a terminal and install it:

```bash
cd ~/Downloads
sudo apt install ./Figmaboy_*_amd64.deb
```

The package installs both executables under `/usr/bin`. Confirm the MCP binary and register its absolute path:

```bash
MCP_BIN="$(command -v figmaboy-mcp)"
test -x "$MCP_BIN"
"$MCP_BIN" --version
codex mcp add figmaboy -- "$MCP_BIN"
codex mcp get figmaboy
```

You can now launch the desktop app from your application menu or with `figmaboy`.

### Fedora or RHEL (`.rpm`)

1. Download the `.rpm` file from the latest release.
2. Install it with DNF:

```bash
cd ~/Downloads
sudo dnf install ./Figmaboy_*_x86_64.rpm
```

The RPM contains both the desktop app and MCP server. Register the installed MCP executable:

```bash
MCP_BIN="$(command -v figmaboy-mcp)"
test -x "$MCP_BIN"
"$MCP_BIN" --version
codex mcp add figmaboy -- "$MCP_BIN"
codex mcp get figmaboy
```

### AppImage and other distributions

Download both of these assets from the same release:

- The `Figmaboy_*.AppImage` desktop app.
- `figmaboy-mcp-x86_64-unknown-linux-gnu`, the standalone MCP server.

Make the AppImage executable, install the MCP binary at a stable user-local path, and register it:

```bash
chmod +x ~/Downloads/Figmaboy_*.AppImage
mkdir -p ~/.local/bin
install -m 755 \
  ~/Downloads/figmaboy-mcp-x86_64-unknown-linux-gnu \
  ~/.local/bin/figmaboy-mcp

"$HOME/.local/bin/figmaboy-mcp" --version
codex mcp add figmaboy -- "$HOME/.local/bin/figmaboy-mcp"
codex mcp get figmaboy
```

Keep `~/.local/bin/figmaboy-mcp` in place after registration. Moving or deleting it breaks the saved Codex command.

Launch the AppImage:

```bash
~/Downloads/Figmaboy_*.AppImage
```

## NixOS

### AppImage release

Download the AppImage and `figmaboy-mcp-x86_64-unknown-linux-gnu`. Install and connect the MCP server exactly once:

```bash
mkdir -p ~/.local/bin
install -m 755 \
  ~/Downloads/figmaboy-mcp-x86_64-unknown-linux-gnu \
  ~/.local/bin/figmaboy-mcp

"$HOME/.local/bin/figmaboy-mcp" --version
codex mcp add figmaboy -- "$HOME/.local/bin/figmaboy-mcp"
codex mcp get figmaboy
```

Run the desktop AppImage through `appimage-run`:

```bash
appimage-run ~/Downloads/Figmaboy_*.AppImage
```

### Native Nix package

A native Figmaboy derivation should expose both `figmaboy` and `figmaboy-mcp` in the same profile. After adding the package to `environment.systemPackages` or your Home Manager packages and rebuilding, confirm both commands exist:

```bash
command -v figmaboy
command -v figmaboy-mcp
```

Register the profile path. Do not resolve it to a versioned `/nix/store` path; the profile symlink remains stable across package updates:

```bash
MCP_BIN="$(command -v figmaboy-mcp)"
test -x "$MCP_BIN"
"$MCP_BIN" --version
codex mcp add figmaboy -- "$MCP_BIN"
codex mcp get figmaboy
```

## macOS

Choose the release that matches your Mac:

| Mac | Check with | Desktop installer | Standalone fallback |
| --- | --- | --- | --- |
| Apple Silicon | `uname -m` prints `arm64` | `aarch64` DMG | `figmaboy-mcp-aarch64-apple-darwin` |
| Intel | `uname -m` prints `x86_64` | `x86_64` DMG | `figmaboy-mcp-x86_64-apple-darwin` |

Open the DMG and drag **Figmaboy** into **Applications**. The DMG app contains the matching MCP executable inside its application bundle.

Register that bundled executable:

```bash
MCP_BIN="/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp"

if [ ! -x "$MCP_BIN" ]; then
  MCP_BIN="$HOME/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp"
fi

test -x "$MCP_BIN"
"$MCP_BIN" --version
codex mcp add figmaboy -- "$MCP_BIN"
codex mcp get figmaboy
```

If you intentionally keep the app somewhere else, change `MCP_BIN` to the matching `Figmaboy.app/Contents/MacOS/figmaboy-mcp` path.

### macOS standalone fallback

If the bundled binary is unavailable, download the standalone MCP asset for your architecture and place it at a stable path. For Apple Silicon:

```bash
mkdir -p ~/.local/bin
install -m 755 \
  ~/Downloads/figmaboy-mcp-aarch64-apple-darwin \
  ~/.local/bin/figmaboy-mcp

codex mcp add figmaboy -- "$HOME/.local/bin/figmaboy-mcp"
codex mcp get figmaboy
```

On an Intel Mac, use `figmaboy-mcp-x86_64-apple-darwin` instead.

Current macOS builds are ad-hoc signed but not notarized. Open Figmaboy once after installation. If macOS blocks it, verify the release checksum and approve Figmaboy in **System Settings → Privacy & Security** before testing the MCP connection.

## Windows

Download and run either the NSIS `.exe` installer or MSI package. Both installers bundle `figmaboy-mcp.exe` beside the installed Figmaboy application.

Open **PowerShell** and locate the bundled server in the standard per-user or system installation directory:

```powershell
$SearchRoots = @(
  (Join-Path $env:LOCALAPPDATA "Figmaboy")
  (Join-Path $env:ProgramFiles "Figmaboy")
)

if (${env:ProgramFiles(x86)}) {
  $SearchRoots += Join-Path ${env:ProgramFiles(x86)} "Figmaboy"
}

$McpBin = Get-ChildItem -Path $SearchRoots -Filter "figmaboy-mcp.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

if (-not $McpBin) {
  throw "figmaboy-mcp.exe was not found in the installed Figmaboy directories."
}

& $McpBin --version
codex mcp add figmaboy -- "$McpBin"
codex mcp get figmaboy
```

### Windows standalone fallback

If the installer path cannot be found, download `figmaboy-mcp-x86_64-pc-windows-msvc.exe` from the same release and copy it to a stable user-local directory:

```powershell
$McpDir = Join-Path $env:LOCALAPPDATA "Figmaboy\bin"
$McpBin = Join-Path $McpDir "figmaboy-mcp.exe"
$DownloadedMcp = Join-Path $HOME "Downloads\figmaboy-mcp-x86_64-pc-windows-msvc.exe"

New-Item -ItemType Directory -Force -Path $McpDir | Out-Null
Copy-Item -LiteralPath $DownloadedMcp -Destination $McpBin -Force

& $McpBin --version
codex mcp add figmaboy -- "$McpBin"
codex mcp get figmaboy
```

Current Windows releases are not code-signed and may trigger SmartScreen. Download only from the official GitHub release and verify the checksum before running either executable.

## Verify the connection

On every platform, this command should show an enabled stdio server named `figmaboy` and the absolute command you registered:

```bash
codex mcp get figmaboy
```

Finish any active Codex session, then start a new session so Codex loads the new MCP configuration.

First test offline context while Figmaboy is closed:

> List my saved Figmaboy designs.

Then open a design in Figmaboy and test the live bridge:

> Inspect the current Figmaboy page and summarize its layer structure. Do not change it.

Offline tools such as `designs_list` and `design_context_get` work while Figmaboy is closed. Live inspection, screenshots, and edits require the desktop app to be open with a design loaded.

## Updating Figmaboy later

You do not need to remove and re-add the MCP registration when the executable remains at the same path:

- Package-manager, Nix profile, macOS application-bundle, MSI, and NSIS updates preserve the registered path.
- AppImage and standalone users should overwrite the existing `~/.local/bin/figmaboy-mcp` or `%LOCALAPPDATA%\Figmaboy\bin\figmaboy-mcp.exe` file instead of moving it.

Run `codex mcp remove figmaboy` and register it again only if the executable path changes.

## Verify release checksums

Every release includes `SHA256SUMS`. On Linux:

```bash
cd ~/Downloads
sha256sum --ignore-missing --check SHA256SUMS
```

On macOS, run `shasum -a 256 <filename>` and compare it with the matching line in `SHA256SUMS`.

On Windows PowerShell:

```powershell
Get-FileHash .\Figmaboy_*.exe -Algorithm SHA256
Get-FileHash .\figmaboy-mcp-*.exe -Algorithm SHA256
```

With the app and MCP connected, continue to the [Quickstart](../quickstart/).
