/**
 * Public TypeScript contract for the Figma Boy MCP server.
 *
 * This file is also returned verbatim by the MCP `types_get` tool. Keep it in
 * sync with src/lib/domain.ts and src-tauri/src/bin/figmaboy-mcp.rs.
 */

export type Id = string;

export type NodeType =
  | "frame"
  | "group"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "text"
  | "image"
  | "icon";

export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "hard-light" | "soft-light"
  | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";

export interface SolidPaint { type: "solid"; color: string; opacity: number }
export interface GradientStop { offset: number; color: string; opacity: number }
export interface LinearGradientPaint { type: "linear-gradient"; angle: number; stops: GradientStop[] }
export interface RadialGradientPaint { type: "radial-gradient"; centerX: number; centerY: number; radius: number; stops: GradientStop[] }
export type Paint = SolidPaint | LinearGradientPaint | RadialGradientPaint;

export interface StrokeStyle {
  color: string;
  opacity: number;
  width: number;
  dash?: number[];
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

/** Use `radius` for a uniform border radius or `cornerRadii` for four corners. */
export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface DropShadowEffect {
  type: "drop-shadow";
  color: string;
  opacity: number;
  x: number;
  y: number;
  blur: number;
  visible?: boolean;
}

export interface LayerBlurEffect { type: "layer-blur"; radius: number; visible?: boolean }
export type LayerEffect = DropShadowEffect | LayerBlurEffect;

/**
 * Node input accepted by operations_apply/create. Only `type` is universally
 * required; omitted fields receive editor defaults. Children must be created
 * with the operation's `parentId`, not by supplying childIds.
 */
export interface NodeInput {
  id?: Id;
  type: NodeType;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  blendMode?: BlendMode;
  visible?: boolean;
  locked?: boolean;
  fill?: Paint | null;
  stroke?: StrokeStyle | null;
  /** Uniform border radius in pixels. Supported by frames, rectangles, and images. */
  radius?: number;
  /** Independent border radii. Takes precedence over `radius`. */
  cornerRadii?: CornerRadii;
  effects?: LayerEffect[];
  clipContent?: boolean;
  points?: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  textAlignVertical?: "top" | "center" | "bottom";
  textCase?: "original" | "upper" | "lower" | "title";
  textDecoration?: "none" | "underline" | "strikethrough";
  textAutoResize?: "none" | "width-and-height" | "height";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  maxLines?: number | null;
  textTruncation?: "disabled" | "ending";
  assetId?: Id;
  mime?: "image/png" | "image/jpeg" | "image/webp";
  fit?: "fill" | "contain" | "cover";
  crop?: { x: number; y: number; width: number; height: number };
  iconName?: string;
}

export type EditOperation =
  | { kind: "create"; node: NodeInput; parentId?: Id | null; index?: number }
  | { kind: "update"; id: Id; patch: Omit<Partial<NodeInput>, "id" | "type"> }
  | { kind: "delete"; ids: Id[] }
  | { kind: "reparent"; ids: Id[]; parentId?: Id | null; index?: number }
  | { kind: "reorder"; parentId?: Id | null; ids: Id[] };

export interface OperationsApplyParams {
  expectedChangeToken?: number;
  operations: EditOperation[];
}

/**
 * Figma-compatible centering behavior:
 * - auto + one node: center it in its parent frame/group.
 * - auto + multiple nodes: align their centers to the selection bounds.
 * - parent: center each same-parent selection as a group in that parent.
 * - selection: align every node to the combined selection center.
 */
export interface NodesCenterParams {
  ids: Id[];
  axis: "horizontal" | "vertical" | "both";
  relativeTo?: "auto" | "selection" | "parent";
  expectedChangeToken?: number;
}

/** Prefer this explicit tool for cards, buttons, panels, badges, and images. */
export type NodesSetBorderRadiusParams = {
  ids: Id[];
  expectedChangeToken?: number;
} & (
  | { radius: number; cornerRadii?: never }
  | { radius?: never; cornerRadii: CornerRadii }
);

export interface FrameScreenshotParams {
  frameId: Id;
  /** Raster scale from 0.25 through 4; output is capped at 4096px. */
  scale?: number;
}

/**
 * Place artwork produced by Codex image generation as a persistent native
 * image layer. Generate first, copy the final asset into the active workspace,
 * then pass its local path here.
 */
export interface ImagePlaceParams {
  path: string;
  name?: string;
  nodeId?: Id;
  parentId?: Id | null;
  /** natural keeps an explicit/natural box; fill-parent covers the parent bounds. */
  placement?: "natural" | "fill-parent";
  x?: number;
  y?: number;
  /** Supply both dimensions, one dimension to preserve aspect ratio, or neither for natural size. */
  width?: number;
  height?: number;
  fit?: "fill" | "contain" | "cover";
  radius?: number;
  opacity?: number;
  blendMode?: BlendMode;
  /** Use index 0 to put a hero/background behind existing siblings. */
  index?: number;
  expectedChangeToken?: number;
}

export interface RenderParams { scope?: "design" | "selection"; ids?: Id[]; scale?: number }
export interface NodesGetParams { ids?: Id[]; type?: NodeType; name?: string }

export interface ToolResult {
  changeToken?: number;
  [key: string]: unknown;
}

/** Available MCP tools and their input contracts. */
export interface FigmaBoyTools {
  editor_status(params?: Record<string, never>): Promise<ToolResult>;
  design_capabilities(params?: Record<string, never>): Promise<ToolResult>;
  types_get(params?: Record<string, never>): Promise<{ language: "typescript"; path: "mcp/types.ts"; source: string }>;
  document_get(params?: Record<string, never>): Promise<ToolResult>;
  nodes_get(params?: NodesGetParams): Promise<ToolResult>;
  geometry_get(params?: { ids?: Id[] }): Promise<ToolResult>;
  operations_apply(params: OperationsApplyParams): Promise<ToolResult>;
  nodes_center(params: NodesCenterParams): Promise<ToolResult>;
  nodes_set_border_radius(params: NodesSetBorderRadiusParams): Promise<ToolResult>;
  image_place(params: ImagePlaceParams): Promise<ToolResult>;
  selection_set(params: { ids: Id[] }): Promise<ToolResult>;
  viewport_focus(params?: { ids?: Id[] }): Promise<ToolResult>;
  frame_screenshot(params: FrameScreenshotParams): Promise<ToolResult>;
  render(params?: RenderParams): Promise<ToolResult>;
  history_undo(params?: Record<string, never>): Promise<ToolResult>;
  history_redo(params?: Record<string, never>): Promise<ToolResult>;
  document_save(params?: Record<string, never>): Promise<ToolResult>;
}
