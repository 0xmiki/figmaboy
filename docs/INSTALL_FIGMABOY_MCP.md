# Install the Figmaboy MCP with Codex

Use this file when a user asks Codex to install or repair the Figmaboy MCP. Do not change a working custom registration.

The chat inside Figmaboy already starts its bundled MCP server. These steps register Figmaboy for the standalone Codex CLI, IDE extension, and ChatGPT desktop app.

## Procedure

1. Confirm that `codex --version` works.
2. Run `codex mcp get figmaboy --json` and inspect `transport.command`.
3. If that command resolves to an executable and `COMMAND --version` succeeds, keep it and stop.
4. Find the copy installed with Figmaboy:

   | Platform | Installed path |
   | --- | --- |
   | Linux `.deb` or `.rpm` | `/usr/bin/figmaboy-mcp` |
   | Linux AppImage or standalone | `~/.local/bin/figmaboy-mcp` |
   | Nix | The path from `command -v figmaboy-mcp` |
   | macOS system Applications | `/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp` |
   | macOS user Applications | `~/Applications/Figmaboy.app/Contents/MacOS/figmaboy-mcp` |
   | Windows NSIS | `%LOCALAPPDATA%\Figmaboy\figmaboy-mcp.exe` |
   | Windows MSI | `%ProgramFiles%\Figmaboy\figmaboy-mcp.exe` |

5. Run the selected executable with `--version`. Use an absolute path for registration.
6. If an existing `figmaboy` entry points to a missing executable, run `codex mcp remove figmaboy`. Do not remove a working entry.
7. Register the executable:

   ```console
   codex mcp add figmaboy -- "/absolute/path/to/figmaboy-mcp"
   ```

   On Windows, use the absolute `.exe` path in the same command.

8. Verify with `codex mcp get figmaboy --json`. Confirm that `transport.type` is `stdio` and `transport.command` is the selected executable.
9. Tell the user to start a new Codex session so it reloads MCP configuration.

## If the executable is missing

Download the matching standalone binary and `SHA256SUMS` from the [latest Figmaboy release](https://github.com/0xmiki/figmaboy/releases/latest). Verify the checksum before running it.

Use these asset names:

- Linux x86_64: `figmaboy-mcp-x86_64-unknown-linux-gnu`
- macOS Apple Silicon: `figmaboy-mcp-aarch64-apple-darwin`
- macOS Intel: `figmaboy-mcp-x86_64-apple-darwin`
- Windows x86_64: `figmaboy-mcp-x86_64-pc-windows-msvc.exe`

Install Linux and macOS standalone binaries as `~/.local/bin/figmaboy-mcp` and make the file executable. Install the Windows binary as `%LOCALAPPDATA%\Figmaboy\bin\figmaboy-mcp.exe`.

Do not register a path inside an AppImage mount, a temporary directory, a downloads directory, or a repository build folder. Those paths will break when the file moves.

If the user's CPU or operating system has no matching release asset, stop and explain that Figmaboy does not publish a compatible binary yet.
