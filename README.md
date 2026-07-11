# Figma Boy

A local-first desktop interface design tool built with Tauri and SvelteKit.

## Codex design MCP

Figma Boy includes a companion `figmaboy-mcp` stdio server. The app remains the source of truth: MCP edits are applied to the design currently open in the editor, appear immediately, participate in undo/redo, and use normal autosave.

The server exposes tools to inspect editor state and nodes, retrieve exact coordinate geometry, atomically create/update/delete/reparent/reorder layers, place generated image assets, center layers horizontally/vertically, set border radii, control selection and viewport focus, undo/redo/save, and capture a complete frame as PNG evidence.

Codex builds designs entirely from native frames, groups, shapes, text, images, and icons. Every visible element remains addressable through MCP and editable in the layer panel. The `design_capabilities` tool returns the current node/style contract plus the expected semantic grouping model; Codex should call it before authoring a design.

Native styling currently includes solid, linear-gradient, and radial-gradient fills; independent corner radii; stroke width, dash, cap, and join controls; blend modes; layered drop shadows and blur; and expanded typography (arbitrary font families, weight, italic, case, decoration, vertical alignment, resizing, paragraph spacing/indentation, and truncation). Designs should use one top-level frame per screen, section-level frames/groups, and named component groups instead of a flat root layer list.

Right-click any frame and choose **Copy as image** to place a high-resolution rasterization of the frame and all of its descendants on the system clipboard. The renderer targets a 3840 px long edge where possible, renders at no less than 2× for ordinary frame sizes, and preserves aspect ratio within the 4096 px safety limit. On Linux it offers both PNG pixels and a cached PNG file URI, so the result can be pasted into image-aware applications or directly into a folder.

The machine-readable TypeScript contract lives at [`mcp/types.ts`](mcp/types.ts) and is returned by the `types_get` MCP tool. Codex should use `nodes_center` for Figma-style center alignment, `nodes_set_border_radius` for rounded surfaces, and `frame_screenshot` to visually review every completed frame.

### Generated artwork

Codex can create hero art, backgrounds, product imagery, textures, illustrations, logos, or transparent cutouts with its image-generation capability and then call `image_place` with the final local PNG, JPEG, or WebP path. Figma Boy validates and persists the file in its asset database and creates a normal editable image layer. For a background, pass the containing frame as `parentId`, use `placement: "fill-parent"`, `fit: "cover"`, and `index: 0`; for a logo or cutout, use a transparent PNG with natural placement and an explicit position/size. Finish by calling `frame_screenshot` and reviewing the composition.

Build and register the development server:

```console
nix-shell --run 'cargo build --release --manifest-path src-tauri/Cargo.toml --bin figmaboy-mcp'
codex mcp add figmaboy -- ./src-tauri/target/release/figmaboy-mcp
```

Start Figma Boy and open a design before calling its tools. Codex loads newly added MCP servers in a new session.

## Development

Run `nix-shell`, then `bun run tauri dev`.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
