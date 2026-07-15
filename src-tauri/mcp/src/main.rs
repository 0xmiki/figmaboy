//! Stdio MCP server for live Figmaboy editing and read-only saved design context.

mod offline;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use directories::BaseDirs;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
};
use uuid::Uuid;

use offline::{preview_image, OfflineContext, OfflineLibrary};

const INSTRUCTIONS: &str = "Use designs_list and design_context_get to inspect saved Figmaboy designs by copied file ID or convenient file name, even while the desktop app is closed. design_context_get returns the saved page document, ordered layer tree, asset metadata, and a visual preview when available. Saved context is read-only and reports its revision. To manipulate a design, open it in Figma Boy, then inspect editor_status, document_get, design_capabilities, and types_get before mutating. Build entirely from native frames, groups, shapes, text, images, and icons. Organize every design as a named semantic tree: one top-level frame per screen; named frames/groups for sections; and named groups for components such as navbars, cards, buttons, feature rows, and media controls. Children use coordinates local to their parent. Prefer a frame when a component has a background or clips content and a group for a structural cluster. Avoid flat piles of root layers. When original raster artwork would improve the design, use Codex image generation, keep the final asset in the active project/workspace, then call image_place with its local path and exact placement. Use nodes_center for precise horizontal/vertical centering. Use nodes_set_border_radius deliberately on cards, buttons, panels, badges, and images instead of leaving every surface square. Use operations_apply for atomic changes and pass expected_change_token. Always call frame_screenshot and visually inspect the resulting image before finishing.";
const TYPESCRIPT_CONTRACT: &str = include_str!("../../../mcp/types.ts");

#[derive(Clone)]
struct BridgeClient {
    discovery_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Discovery {
    port: u16,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest<'a> {
    id: String,
    token: &'a str,
    method: &'a str,
    params: Value,
}

#[derive(Deserialize)]
struct BridgeResponse {
    result: Option<Value>,
    error: Option<String>,
}

impl BridgeClient {
    fn from_env() -> Result<Self, String> {
        let discovery_path = if let Some(path) = std::env::var_os("FIGMABOY_BRIDGE_FILE") {
            PathBuf::from(path)
        } else {
            BaseDirs::new()
                .ok_or_else(|| "Could not locate the user data directory".to_string())?
                .data_local_dir()
                .join("com.miki.figmaboy")
                .join("editor-bridge.json")
        };
        Ok(Self { discovery_path })
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let discovery: Discovery =
            serde_json::from_slice(&tokio::fs::read(&self.discovery_path).await.map_err(|_| {
                "Figma Boy is not running; open the app and a design file".to_string()
            })?)
            .map_err(|error| format!("Invalid Figma Boy bridge discovery: {error}"))?;
        let mut stream = TcpStream::connect(("127.0.0.1", discovery.port))
            .await
            .map_err(|_| {
                "Could not connect to Figma Boy; restart the app if it was recently closed"
                    .to_string()
            })?;
        let request = BridgeRequest {
            id: Uuid::new_v4().simple().to_string(),
            token: &discovery.token,
            method,
            params,
        };
        let mut encoded = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        stream
            .write_all(&encoded)
            .await
            .map_err(|error| error.to_string())?;
        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .await
            .map_err(|error| error.to_string())?;
        let response: BridgeResponse =
            serde_json::from_str(&line).map_err(|error| error.to_string())?;
        match response.error {
            Some(error) => Err(error),
            None => Ok(response.result.unwrap_or(Value::Null)),
        }
    }
}

#[derive(Debug, Default, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodesGetParams {
    /// Exact node IDs. Omit to return all nodes.
    ids: Option<Vec<String>>,
    /// Optional exact node type filter.
    #[serde(rename = "type")]
    node_type: Option<String>,
    /// Optional case-insensitive node-name substring.
    name: Option<String>,
}

#[derive(Debug, Default, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignsListParams {
    /// Optional case-insensitive substring matched against design and project names.
    query: Option<String>,
    /// Maximum results from 1 through 200. Defaults to 50.
    limit: Option<usize>,
    /// Include designs currently in trash. Defaults to false.
    #[serde(default)]
    include_trashed: bool,
}

#[derive(Debug, Default, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignContextParams {
    /// Exact stable design ID copied from Figmaboy. Provide this or fileName.
    file_id: Option<String>,
    /// Exact case-insensitive design name. Convenient, but ambiguous names require fileId.
    file_name: Option<String>,
    /// Exact stable page ID. Omit to use pageName or the first page.
    page_id: Option<String>,
    /// Exact case-insensitive page name. Omit to use the first page.
    page_name: Option<String>,
}

#[derive(Debug, Default, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdsParams {
    /// Node IDs. Omit for the current selection where supported.
    #[serde(default)]
    ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum EditOperation {
    /// Create a native layer. node.type is required; id, x, y and all type-specific properties are optional.
    Create {
        node: Value,
        parent_id: Option<String>,
        index: Option<usize>,
    },
    /// Patch editable properties on an existing node. id, type, parentId and childIds cannot be patched.
    Update { id: String, patch: Value },
    /// Delete nodes and their descendants.
    Delete { ids: Vec<String> },
    /// Move nodes into a frame/group or to the page root. Coordinates remain local to the new parent.
    Reparent {
        ids: Vec<String>,
        parent_id: Option<String>,
        index: Option<usize>,
    },
    /// Replace the complete sibling order for a parent or the page root.
    Reorder {
        parent_id: Option<String>,
        ids: Vec<String>,
    },
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyParams {
    /// Change token returned by editor_status/document_get. The edit is rejected if the open document changed since inspection.
    expected_change_token: Option<u64>,
    /// Operations applied atomically as one undo entry.
    operations: Vec<EditOperation>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct CenterParams {
    /// Node IDs to center. One node centers in its parent by default; multiple nodes center to their selection bounds.
    ids: Vec<String>,
    /// horizontal, vertical, or both.
    axis: String,
    /// auto (default), selection, or parent. Parent mode preserves the spacing of each same-parent group.
    relative_to: Option<String>,
    /// Optional optimistic-concurrency token from editor_status/document_get.
    expected_change_token: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct CornerRadiiParams {
    top_left: f64,
    top_right: f64,
    bottom_right: f64,
    bottom_left: f64,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct BorderRadiusParams {
    /// Frame, rectangle, or image node IDs.
    ids: Vec<String>,
    /// Uniform border radius in pixels. Provide this or cornerRadii, never both.
    radius: Option<f64>,
    /// Independent corner radii. Provide this or radius, never both.
    corner_radii: Option<CornerRadiiParams>,
    /// Optional optimistic-concurrency token from editor_status/document_get.
    expected_change_token: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderParams {
    /// Render the full design or selected/specified nodes.
    #[serde(default = "default_scope")]
    scope: String,
    /// Explicit node IDs; omit to use all roots for design scope or current selection for selection scope.
    ids: Option<Vec<String>>,
    /// Raster scale from 0.25 through 4. Output dimensions are capped at 4096 px.
    scale: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameScreenshotParams {
    /// Exact ID of the frame to capture, including all descendants.
    frame_id: String,
    /// Raster scale from 0.25 through 4. Output dimensions are capped at 4096 px.
    scale: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePlaceParams {
    /// Absolute or current-working-directory-relative path to a generated PNG, JPEG, or WebP file.
    path: String,
    /// Semantic layer name, such as Hero background or Brand mark.
    name: Option<String>,
    /// Optional stable node ID.
    node_id: Option<String>,
    /// Optional frame/group parent. Child coordinates are local to this parent.
    parent_id: Option<String>,
    /// natural (default) or fill-parent. fill-parent requires parentId and covers its full bounds.
    placement: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    /// Node width. When only one dimension is supplied, aspect ratio is preserved.
    width: Option<f64>,
    /// Node height. When only one dimension is supplied, aspect ratio is preserved.
    height: Option<f64>,
    /// fill, contain, or cover. Defaults to contain, or cover for fill-parent.
    fit: Option<String>,
    radius: Option<f64>,
    opacity: Option<f64>,
    blend_mode: Option<String>,
    /// Sibling insertion index. Use 0 for a background behind existing children.
    index: Option<usize>,
    expected_change_token: Option<u64>,
}

fn default_scope() -> String {
    "design".into()
}

fn image_result(mut value: Value) -> CallToolResult {
    let image = value
        .get("imageBase64")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(object) = value.as_object_mut() {
        object.remove("imageBase64");
    }
    let mut result = CallToolResult::structured(value);
    if let Some(image) = image {
        result
            .content
            .insert(0, ContentBlock::image(image, "image/png"));
    }
    result
}

fn offline_context_result(mut context: OfflineContext) -> CallToolResult {
    let image = context
        .preview_data_url
        .as_deref()
        .map(preview_image)
        .transpose();
    let preview = context
        .value
        .get_mut("preview")
        .and_then(Value::as_object_mut);
    match image {
        Ok(Some((image, mime_type, width, height))) => {
            if let Some(preview) = preview {
                preview.insert("mimeType".into(), Value::String(mime_type.clone()));
                preview.insert("width".into(), Value::from(width));
                preview.insert("height".into(), Value::from(height));
            }
            let mut result = CallToolResult::structured(context.value);
            result
                .content
                .insert(0, ContentBlock::image(image, mime_type));
            result
        }
        Ok(None) => CallToolResult::structured(context.value),
        Err(error) => {
            if let Some(preview) = preview {
                preview.insert("renderError".into(), Value::String(error));
            }
            CallToolResult::structured(context.value)
        }
    }
}

#[derive(Clone)]
struct FigmaboyMcp {
    bridge: BridgeClient,
    offline: OfflineLibrary,
    tool_router: ToolRouter<Self>,
}

impl FigmaboyMcp {
    fn new(bridge: BridgeClient, offline: OfflineLibrary) -> Self {
        Self {
            bridge,
            offline,
            tool_router: Self::tool_router(),
        }
    }

    async fn call<T: Serialize>(&self, method: &str, params: T) -> CallToolResult {
        let params = match serde_json::to_value(params) {
            Ok(value) => value,
            Err(error) => return tool_error(error.to_string()),
        };
        match self.bridge.call(method, params).await {
            Ok(value) => CallToolResult::structured(value),
            Err(error) => tool_error(error),
        }
    }
}

#[tool_router]
impl FigmaboyMcp {
    #[tool(
        description = "List saved Figmaboy designs with stable copyable file IDs, names, projects, timestamps, and page counts. Works while Figmaboy is closed. Use query to search by design or project name."
    )]
    async fn designs_list(
        &self,
        Parameters(params): Parameters<DesignsListParams>,
    ) -> CallToolResult {
        match self
            .offline
            .list_designs(params.query, params.limit, params.include_trashed)
            .await
        {
            Ok(value) => CallToolResult::structured(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "Load a saved Figmaboy page as read-only implementation context by exact fileId or convenient fileName. Returns the full native document, ordered layer tree, page revisions, asset metadata, and a visual preview when available. Works while Figmaboy is closed."
    )]
    async fn design_context_get(
        &self,
        Parameters(params): Parameters<DesignContextParams>,
    ) -> CallToolResult {
        match self
            .offline
            .design_context(
                params.file_id,
                params.file_name,
                params.page_id,
                params.page_name,
            )
            .await
        {
            Ok(context) => offline_context_result(context),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "Get the active Figma Boy file/page, save state, selection, document change token, viewport, and exact canvas client/screen geometry."
    )]
    async fn editor_status(&self) -> CallToolResult {
        self.call("editor_status", json!({})).await
    }

    #[tool(
        description = "Get the native node/style capability reference and the required semantic grouping conventions for Codex-authored designs."
    )]
    async fn design_capabilities(&self) -> CallToolResult {
        CallToolResult::structured(json!({
            "hierarchy": {
                "rule": "Create a named semantic tree instead of a flat layer list. Create parents before children and pass parentId on child create operations.",
                "screen": "One top-level frame per screen or artboard",
                "section": "Use a named frame/group for each navbar, hero, feature section, gallery, pricing section, and footer",
                "component": "Use a named frame/group for each card, button, badge, input, logo lockup, illustration cluster, or media control",
                "frameVsGroup": "Use frame for a visible background or clipping boundary; group for a structural cluster without its own appearance",
                "coordinates": "A child's x/y are local to its parent"
            },
            "nodeTypes": ["frame", "group", "rectangle", "ellipse", "line", "arrow", "polygon", "star", "text", "image", "icon"],
            "common": {
                "geometry": ["name", "x", "y", "width", "height", "rotation", "opacity", "visible", "locked"],
                "blendMode": ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
                "uniformCorners": { "radius": 16 },
                "independentCorners": { "cornerRadii": { "topLeft": 24, "topRight": 8, "bottomRight": 24, "bottomLeft": 8 } },
                "fill": [
                    { "type": "solid", "color": "#7c3aed", "opacity": 1.0 },
                    { "type": "linear-gradient", "angle": 135, "stops": [{ "offset": 0.0, "color": "#7c3aed", "opacity": 1.0 }, { "offset": 1.0, "color": "#06b6d4", "opacity": 1.0 }] },
                    { "type": "radial-gradient", "centerX": 0.5, "centerY": 0.4, "radius": 0.75, "stops": [{ "offset": 0.0, "color": "#ffffff", "opacity": 1.0 }, { "offset": 1.0, "color": "#7c3aed", "opacity": 1.0 }] }
                ],
                "stroke": { "color": "#ffffff", "opacity": 0.8, "width": 2, "dash": [8, 4], "cap": "round", "join": "round" },
                "effects": [
                    { "type": "drop-shadow", "color": "#000000", "opacity": 0.24, "x": 0, "y": 12, "blur": 32 },
                    { "type": "layer-blur", "radius": 8 }
                ],
                "legacyShadow": { "shadow": { "color": "#000000", "opacity": 0.2, "x": 0, "y": 8, "blur": 24 } }
            },
            "alignment": {
                "tool": "nodes_center",
                "axes": ["horizontal", "vertical", "both"],
                "behavior": "One node centers in its parent; multiple nodes align to their combined selection center. Set relativeTo=parent to center each same-parent selection as a group while preserving its internal spacing."
            },
            "borderRadius": {
                "tool": "nodes_set_border_radius",
                "uniform": { "radius": 16 },
                "independent": { "cornerRadii": { "topLeft": 24, "topRight": 8, "bottomRight": 24, "bottomLeft": 8 } },
                "guidance": "Use rounded corners intentionally on cards, buttons, panels, badges, and images."
            },
            "generatedImages": {
                "tool": "image_place",
                "workflow": ["generate or edit with Codex image generation", "save/copy the final asset into the active workspace", "inspect parent geometry", "call image_place with the local path", "call frame_screenshot and review"],
                "placements": ["natural", "fill-parent"],
                "backgroundTip": "For a hero/background, set parentId, placement=fill-parent, fit=cover, and index=0.",
                "logoTip": "For a logo or cutout, use a transparent PNG, placement=natural, fit=contain, and explicit x/y plus one dimension."
            },
            "text": {
                "content": ["text", "fontFamily", "fontSize", "fontWeight", "fontStyle"],
                "fontStyle": ["normal", "italic"],
                "textAlign": ["left", "center", "right"],
                "textAlignVertical": ["top", "center", "bottom"],
                "textCase": ["original", "upper", "lower", "title"],
                "textDecoration": ["none", "underline", "strikethrough"],
                "textAutoResize": ["none", "width-and-height", "height"],
                "spacing": ["lineHeight (multiplier)", "letterSpacing (px)", "paragraphSpacing (px)", "paragraphIndent (px)"],
                "truncation": { "textTruncation": "ending", "maxLines": 3 },
                "note": "Any installed font-family string is accepted; prefer a deliberate display/body pairing and a clear type scale."
            },
            "containers": { "childIds": "managed by operations", "clipContent": "frame-only clipping toggle" },
            "review": { "tool": "frame_screenshot", "rule": "Capture each completed frame and visually review it before finishing." },
            "typescriptContract": { "tool": "types_get", "path": "mcp/types.ts" },
            "workflow": ["inspect types/capabilities", "create semantic parents", "create children with parentId", "center and round surfaces", "frame_screenshot", "visually inspect", "refine", "save"]
        }))
    }

    #[tool(
        description = "Return the complete TypeScript contract for native nodes, styles, edit operations, and every Figma Boy MCP tool."
    )]
    async fn types_get(&self) -> CallToolResult {
        CallToolResult::structured(json!({
            "language": "typescript",
            "path": "mcp/types.ts",
            "source": TYPESCRIPT_CONTRACT
        }))
    }

    #[tool(
        description = "Get the complete open PageDocument, including its ordered layer tree and current change token."
    )]
    async fn document_get(&self) -> CallToolResult {
        self.call("document_get", json!({})).await
    }

    #[tool(description = "Get full node records by ID or filter all nodes by type/name.")]
    async fn nodes_get(&self, Parameters(params): Parameters<NodesGetParams>) -> CallToolResult {
        self.call("nodes_get", params).await
    }

    #[tool(
        description = "Get exact local, world, canvas-client, and rotated-corner geometry for nodes. Omit IDs to inspect the current selection."
    )]
    async fn geometry_get(&self, Parameters(params): Parameters<IdsParams>) -> CallToolResult {
        self.call("geometry_get", params).await
    }

    #[tool(
        description = "Atomically create, update, delete, reparent, or reorder native layers. Create named semantic parent frames/groups before their children; child coordinates are parent-local. The entire batch is one undo step and is validated before application."
    )]
    async fn operations_apply(
        &self,
        Parameters(params): Parameters<ApplyParams>,
    ) -> CallToolResult {
        self.call("operations_apply", params).await
    }

    #[tool(
        description = "Center native layers horizontally, vertically, or on both axes using Figma-compatible behavior. One node centers in its parent; multiple nodes center relative to one another. relativeTo=parent centers each same-parent selection as a group while preserving spacing."
    )]
    async fn nodes_center(&self, Parameters(params): Parameters<CenterParams>) -> CallToolResult {
        self.call("nodes_center", params).await
    }

    #[tool(
        description = "Set a uniform or independent border radius on frames, rectangles, and images. Use this explicitly for polished cards, buttons, panels, badges, and media."
    )]
    async fn nodes_set_border_radius(
        &self,
        Parameters(params): Parameters<BorderRadiusParams>,
    ) -> CallToolResult {
        self.call("nodes_set_border_radius", params).await
    }

    #[tool(
        description = "Import a Codex-generated PNG, JPEG, or WebP from a local path, persist it in the open Figma Boy file, and place it as a native editable image layer. Use placement=fill-parent and index=0 for hero/background artwork."
    )]
    async fn image_place(
        &self,
        Parameters(params): Parameters<ImagePlaceParams>,
    ) -> CallToolResult {
        let data = match tokio::fs::read(&params.path).await {
            Ok(data) => data,
            Err(error) => {
                return tool_error(format!(
                    "Could not read generated image {}: {error}",
                    params.path
                ))
            }
        };
        if data.len() > 50 * 1024 * 1024 {
            return tool_error("Images must be smaller than 50 MB".into());
        }
        let mut payload = match serde_json::to_value(params) {
            Ok(Value::Object(payload)) => payload,
            Ok(_) => return tool_error("Could not encode image placement".into()),
            Err(error) => return tool_error(error.to_string()),
        };
        payload.remove("path");
        payload.insert("imageBase64".into(), Value::String(BASE64.encode(data)));
        match self
            .bridge
            .call("image_place", Value::Object(payload))
            .await
        {
            Ok(value) => CallToolResult::structured(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(description = "Replace the current editor selection with exact node IDs.")]
    async fn selection_set(&self, Parameters(params): Parameters<IdsParams>) -> CallToolResult {
        self.call("selection_set", params).await
    }

    #[tool(
        description = "Fit the viewport to specified nodes, or to the full design when IDs are omitted."
    )]
    async fn viewport_focus(&self, Parameters(params): Parameters<IdsParams>) -> CallToolResult {
        self.call("viewport_focus", params).await
    }

    #[tool(
        description = "Undo the most recent editor mutation, including one atomic MCP operation batch."
    )]
    async fn history_undo(&self) -> CallToolResult {
        self.call("history_undo", json!({})).await
    }

    #[tool(description = "Redo the most recently undone editor mutation.")]
    async fn history_redo(&self) -> CallToolResult {
        self.call("history_redo", json!({})).await
    }

    #[tool(
        description = "Immediately persist the open page and return its database revision/save state."
    )]
    async fn document_save(&self) -> CallToolResult {
        self.call("document_save", json!({})).await
    }

    #[tool(
        description = "Capture one complete frame and all descendants as a PNG image for visual review. Use after each meaningful design pass."
    )]
    async fn frame_screenshot(
        &self,
        Parameters(params): Parameters<FrameScreenshotParams>,
    ) -> CallToolResult {
        match self
            .bridge
            .call(
                "frame_screenshot",
                serde_json::to_value(params).unwrap_or_else(|_| json!({})),
            )
            .await
        {
            Ok(value) => image_result(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "Render the full design or selected nodes to PNG and return visual evidence with exact design bounds."
    )]
    async fn render(&self, Parameters(params): Parameters<RenderParams>) -> CallToolResult {
        match self
            .bridge
            .call(
                "render",
                serde_json::to_value(params).unwrap_or_else(|_| json!({})),
            )
            .await
        {
            Ok(value) => image_result(value),
            Err(error) => tool_error(error),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for FigmaboyMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "figmaboy-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(INSTRUCTIONS)
    }
}

fn tool_error(message: String) -> CallToolResult {
    CallToolResult::structured_error(json!({ "ok": false, "error": { "message": message } }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if matches!(std::env::args().nth(1).as_deref(), Some("--version" | "-V")) {
        println!("figmaboy-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    let bridge = BridgeClient::from_env().map_err(std::io::Error::other)?;
    let offline = OfflineLibrary::from_env().map_err(std::io::Error::other)?;
    let service = FigmaboyMcp::new(bridge, offline)
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
