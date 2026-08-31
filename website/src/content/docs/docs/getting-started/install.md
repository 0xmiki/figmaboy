---
title: Install Figmaboy
description: Install the desktop app on Linux, macOS, or Windows and open the built-in Codex tab.
---

[Download Figmaboy for your platform](../../../download/)

Install the [Codex CLI](https://developers.openai.com/codex/cli/) and sign in once if you want to use the Codex tab. Open a design and select **Codex** in the right sidebar. Figmaboy supplies its bundled design tools automatically.

No MCP setup is required inside Figmaboy. The installer includes the design tools used by its Codex tab.

## Install the desktop app

Figmaboy installers contain the desktop app and its matching `figmaboy-mcp` server.

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

The built-in Codex tab uses the bundled AppImage sidecar. There is nothing else to configure.

### NixOS

Run the AppImage with `appimage-run`:

```bash
appimage-run ~/Downloads/Figmaboy_*.AppImage
```


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

Codex should return the active page and its layer structure. If it does not, restart the Codex connection or reopen Figmaboy.

## Update Figmaboy

Install the new desktop build over the current one. Figmaboy updates the bundled design tools with the application.

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
```

Continue with the [Quickstart](../quickstart/).
