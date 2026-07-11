export type Id = string;

export type Tool =
  | "select"
  | "hand"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "text"
  | "image";

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

export interface SolidPaint {
  type: "solid";
  color: string;
  opacity: number;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface LinearGradientPaint {
  type: "linear-gradient";
  angle: number;
  stops: GradientStop[];
}

export interface RadialGradientPaint {
  type: "radial-gradient";
  centerX: number;
  centerY: number;
  radius: number;
  stops: GradientStop[];
}

export type Paint = SolidPaint | LinearGradientPaint | RadialGradientPaint;

export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "hard-light" | "soft-light"
  | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";

export interface StrokeStyle {
  color: string;
  opacity: number;
  width: number;
  dash?: number[];
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ShadowStyle {
  color: string;
  opacity: number;
  x: number;
  y: number;
  blur: number;
}

export interface DropShadowEffect extends ShadowStyle {
  type: "drop-shadow";
  visible?: boolean;
}

export interface LayerBlurEffect {
  type: "layer-blur";
  radius: number;
  visible?: boolean;
}

export type LayerEffect = DropShadowEffect | LayerBlurEffect;

export interface NavigateInteraction {
  trigger: "click";
  action: "navigate";
  targetFrameId: Id;
}

export interface CommonNode {
  id: Id;
  type: NodeType;
  name: string;
  parentId: Id | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  blendMode?: BlendMode;
  visible: boolean;
  locked: boolean;
  fill: Paint | null;
  stroke: StrokeStyle | null;
  radius: number;
  cornerRadii?: CornerRadii;
  shadow: ShadowStyle | null;
  effects?: LayerEffect[];
  interaction?: NavigateInteraction;
}

export interface ContainerNode extends CommonNode {
  type: "frame" | "group";
  childIds: Id[];
  clipContent: boolean;
}

export interface ShapeNode extends CommonNode {
  type: "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "star";
  points?: number;
}

export interface TextNode extends CommonNode {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  letterSpacing: number;
  textAlign: "left" | "center" | "right";
  textAlignVertical: "top" | "center" | "bottom";
  textCase: "original" | "upper" | "lower" | "title";
  textDecoration: "none" | "underline" | "strikethrough";
  textAutoResize: "none" | "width-and-height" | "height";
  paragraphSpacing: number;
  paragraphIndent: number;
  maxLines: number | null;
  textTruncation: "disabled" | "ending";
  autoWidth: boolean;
}

export interface ImageNode extends CommonNode {
  type: "image";
  assetId: Id;
  mime: "image/png" | "image/jpeg" | "image/webp";
  fit: "fill" | "contain" | "cover";
  crop: { x: number; y: number; width: number; height: number };
}

export interface IconNode extends CommonNode {
  type: "icon";
  iconName: string;
}

export type DesignNode = ContainerNode | ShapeNode | TextNode | ImageNode | IconNode;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PageDocument {
  schemaVersion: 1;
  rootIds: Id[];
  nodes: Record<Id, DesignNode>;
  viewport: Viewport;
  prototypeStartFrameId: Id | null;
}

export interface Project {
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface DesignFile {
  id: Id;
  projectId: Id | null;
  name: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  trashedAt: string | null;
  thumbnail: string | null;
}

export interface PageMeta {
  id: Id;
  fileId: Id;
  name: string;
  position: number;
  revision: number;
}

export interface OpenedFile {
  file: DesignFile;
  pages: PageMeta[];
  page: PageMeta;
  document: PageDocument;
}

export interface LibrarySnapshot {
  projects: Project[];
  files: DesignFile[];
}

export interface ImportedAsset {
  id: Id;
  mime: ImageNode["mime"];
  dataUrl: string;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function uid(prefix = "id"): Id {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw}`;
}

export function emptyDocument(): PageDocument {
  return {
    schemaVersion: 1,
    rootIds: [],
    nodes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    prototypeStartFrameId: null,
  };
}

export function solid(color: string, opacity = 1): SolidPaint {
  return { type: "solid", color, opacity };
}

export function defaultNode(type: NodeType, x: number, y: number, overrides: Partial<DesignNode> = {}): DesignNode {
  const names: Record<NodeType, string> = {
    frame: "Frame",
    group: "Group",
    rectangle: "Rectangle",
    ellipse: "Ellipse",
    line: "Line",
    arrow: "Arrow",
    polygon: "Polygon",
    star: "Star",
    text: "Text",
    image: "Image",
    icon: "Icon",
  };
  const base: CommonNode = {
    id: uid("node"),
    type,
    name: names[type],
    parentId: null,
    x,
    y,
    width: type === "text" ? 96 : 120,
    height: type === "text" ? 28 : type === "line" || type === "arrow" ? 0 : 96,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: type === "line" || type === "arrow" ? null : solid(type === "frame" ? "#ffffff" : "#a78bfa"),
    stroke: type === "line" || type === "arrow" ? { color: "#e5e7eb", opacity: 1, width: 2 } : null,
    radius: 0,
    shadow: null,
  };

  if (type === "frame" || type === "group") {
    return { ...base, type, childIds: [], clipContent: type === "frame", ...overrides } as ContainerNode;
  }
  if (type === "text") {
    const textNode = {
      ...base,
      type,
      fill: solid("#18181b"),
      text: "Text",
      fontFamily: "Inter, sans-serif",
      fontSize: 20,
      fontWeight: 400,
      fontStyle: "normal",
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: "left",
      textAlignVertical: "top",
      textCase: "original",
      textDecoration: "none",
      textAutoResize: "width-and-height",
      paragraphSpacing: 0,
      paragraphIndent: 0,
      maxLines: null,
      textTruncation: "disabled",
      autoWidth: true,
      ...overrides,
    } as TextNode;
    if ("autoWidth" in overrides && !("textAutoResize" in overrides)) textNode.textAutoResize = textNode.autoWidth ? "width-and-height" : "height";
    if ("textAutoResize" in overrides && !("autoWidth" in overrides)) textNode.autoWidth = textNode.textAutoResize === "width-and-height";
    return textNode;
  }
  if (type === "image") {
    return {
      ...base,
      type,
      fill: null,
      assetId: "",
      mime: "image/png",
      fit: "cover",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      ...overrides,
    } as ImageNode;
  }
  if (type === "icon") {
    return { ...base, type, fill: solid("#ffffff"), iconName: "sparkles", ...overrides } as IconNode;
  }
  return { ...base, type, points: type === "star" ? 5 : type === "polygon" ? 6 : undefined, ...overrides } as ShapeNode;
}

export function cloneDocument(document: PageDocument): PageDocument {
  return JSON.parse(JSON.stringify(document)) as PageDocument;
}
