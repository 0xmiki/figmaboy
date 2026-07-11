<script lang="ts">
  import type { DesignNode, PageDocument, TextNode } from "$lib/domain";
  import { iconData } from "$lib/icon-catalog";
  import { polygonPoints } from "$lib/geometry";
  import { layoutText } from "$lib/text-layout";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";

  let {
    node, document, selectedIds, imageSources, interactive = true, preview = false, unclippedFrameIds = new Set<string>(),
    onNodePointerDown, onNodeDoubleClick, onNodeContextMenu, onPrototypeClick,
  }: {
    node: DesignNode;
    document: PageDocument;
    selectedIds: string[];
    imageSources: Record<string, string>;
    interactive?: boolean;
    preview?: boolean;
    unclippedFrameIds?: ReadonlySet<string>;
    onNodePointerDown?: (event: PointerEvent, id: string) => void;
    onNodeDoubleClick?: (event: MouseEvent, id: string) => void;
    onNodeContextMenu?: (event: MouseEvent, id: string) => void;
    onPrototypeClick?: (id: string) => void;
  } = $props();

  const fillValue = $derived(node.fill ? node.fill.type === "solid" ? node.fill.color : `url(#fill-${node.id})` : "none");
  const fillOpacity = $derived(node.fill?.type === "solid" ? node.fill.opacity : 1);
  const strokeValue = $derived(node.stroke?.color ?? "none");
  const icon = $derived(node.type === "icon" ? iconData(node.iconName) : null);
  const textLayout = $derived(node.type === "text" ? layoutText(node) : null);
  const cornerPath = $derived(roundedRectPath(node.width, node.height, node.cornerRadii, node.radius));
  const effectFilter = $derived.by(() => {
    const filters: string[] = [];
    if (node.shadow) filters.push(dropShadow(node.shadow));
    for (const effect of node.effects ?? []) {
      if (effect.visible === false) continue;
      if (effect.type === "drop-shadow") filters.push(dropShadow(effect));
      else filters.push(`blur(${Math.max(0, effect.radius)}px)`);
    }
    return filters.length ? filters.join(" ") : undefined;
  });

  function pointerDown(event: PointerEvent) {
    if (!interactive || preview) return;
    event.stopPropagation();
    onNodePointerDown?.(event, node.id);
  }

  function doubleClick(event: MouseEvent) {
    if (!interactive || preview) return;
    event.stopPropagation();
    onNodeDoubleClick?.(event, node.id);
  }

  function click(event: MouseEvent) {
    if (!preview) return;
    event.stopPropagation();
    onPrototypeClick?.(node.id);
  }

  function contextMenu(event: MouseEvent) {
    if (!interactive || preview) return;
    event.preventDefault();
    event.stopPropagation();
    onNodeContextMenu?.(event, node.id);
  }

  function keyActivate(event: KeyboardEvent) {
    if (preview && node.interaction && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onPrototypeClick?.(node.id);
    }
  }

  function textX(text: TextNode, indent = 0): number {
    return text.textAlign === "left" ? indent : text.textAlign === "center" ? text.width / 2 : text.width - indent;
  }

  function textTop(text: TextNode): number {
    const contentHeight = textLayout?.height ?? text.height;
    if (text.textAlignVertical === "center") return Math.max(0, (text.height - contentHeight) / 2);
    if (text.textAlignVertical === "bottom") return Math.max(0, text.height - contentHeight);
    return 0;
  }

  function dropShadow(shadow: { color: string; opacity: number; x: number; y: number; blur: number }): string {
    return `drop-shadow(${shadow.x}px ${shadow.y}px ${Math.max(0, shadow.blur / 2)}px ${colorWithOpacity(shadow.color, shadow.opacity)})`;
  }

  function colorWithOpacity(color: string, opacity: number): string {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) return color;
    const value = Number.parseInt(match[1], 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
  }

  function roundedRectPath(width: number, height: number, radii: DesignNode["cornerRadii"], fallback: number): string {
    const max = Math.max(0, Math.min(Math.abs(width), Math.abs(height)) / 2);
    const clamp = (value: number) => Math.max(0, Math.min(max, value));
    const tl = clamp(radii?.topLeft ?? fallback);
    const tr = clamp(radii?.topRight ?? fallback);
    const br = clamp(radii?.bottomRight ?? fallback);
    const bl = clamp(radii?.bottomLeft ?? fallback);
    return `M${tl},0 H${width - tr} Q${width},0 ${width},${tr} V${height - br} Q${width},${height} ${width - br},${height} H${bl} Q0,${height} 0,${height - bl} V${tl} Q0,0 ${tl},0 Z`;
  }
</script>

{#if node.visible}
  <g
    data-node-id={node.id}
    transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.width / 2} ${node.height / 2})`}
    opacity={node.opacity}
    class:selected={selectedIds.includes(node.id)}
    class:prototype-link={preview && Boolean(node.interaction)}
    onpointerdown={pointerDown}
    ondblclick={doubleClick}
    oncontextmenu={contextMenu}
    onclick={click}
    onkeydown={keyActivate}
    role="button"
    aria-label={node.name}
    tabindex={preview && node.interaction ? 0 : -1}
    style:cursor={preview && node.interaction ? "pointer" : node.locked ? "not-allowed" : "default"}
    style:mix-blend-mode={node.blendMode ?? "normal"}
  >
    <defs>
      {#if node.fill?.type === "linear-gradient"}
        {@const radians = (node.fill.angle * Math.PI) / 180}
        {@const x1 = 50 - Math.cos(radians) * 50}
        {@const y1 = 50 - Math.sin(radians) * 50}
        {@const x2 = 50 + Math.cos(radians) * 50}
        {@const y2 = 50 + Math.sin(radians) * 50}
        <linearGradient id={`fill-${node.id}`} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}>
          {#each node.fill.stops as stop}<stop offset={`${stop.offset * 100}%`} stop-color={stop.color} stop-opacity={stop.opacity} />{/each}
        </linearGradient>
      {/if}
      {#if node.fill?.type === "radial-gradient"}
        <radialGradient id={`fill-${node.id}`} cx={`${node.fill.centerX * 100}%`} cy={`${node.fill.centerY * 100}%`} r={`${node.fill.radius * 100}%`}>
          {#each node.fill.stops as stop}<stop offset={`${stop.offset * 100}%`} stop-color={stop.color} stop-opacity={stop.opacity} />{/each}
        </radialGradient>
      {/if}
      {#if node.type === "frame" && node.clipContent}<clipPath id={`clip-${node.id}`}><path d={cornerPath} /></clipPath>{/if}
      {#if node.type === "image"}<clipPath id={`image-clip-${node.id}`}><path d={cornerPath} /></clipPath>{/if}
      {#if node.type === "arrow"}
        <marker id={`arrow-${node.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={strokeValue} /></marker>
      {/if}
    </defs>

    <g style:filter={effectFilter}>
      {#if node.type === "rectangle" || node.type === "frame"}
        <path d={cornerPath} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 0} stroke-dasharray={node.stroke?.dash?.join(" ")} stroke-linecap={node.stroke?.cap} stroke-linejoin={node.stroke?.join} />
      {:else if node.type === "group"}
        <rect width={Math.max(1, node.width)} height={Math.max(1, node.height)} fill="transparent" stroke="transparent" />
      {:else if node.type === "ellipse"}
        <ellipse cx={node.width / 2} cy={node.height / 2} rx={Math.abs(node.width / 2)} ry={Math.abs(node.height / 2)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 0} stroke-dasharray={node.stroke?.dash?.join(" ")} />
      {:else if node.type === "line" || node.type === "arrow"}
        <line x1="0" y1="0" x2={node.width} y2={node.height} fill="none" stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 2} stroke-dasharray={node.stroke?.dash?.join(" ")} stroke-linecap={node.stroke?.cap ?? "round"} marker-end={node.type === "arrow" ? `url(#arrow-${node.id})` : undefined} />
      {:else if node.type === "polygon"}
        <polygon points={polygonPoints(node.width, node.height, node.points ?? 6)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} />
      {:else if node.type === "star"}
        <polygon points={polygonPoints(node.width, node.height, node.points ?? 5, .44)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} />
      {:else if node.type === "text"}
        <rect width={Math.max(1, node.width)} height={textLayout?.height ?? node.height} fill="transparent" />
        <text x={textX(node)} y={textTop(node) + node.fontSize} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} font-family={node.fontFamily} font-size={node.fontSize} font-weight={node.fontWeight} font-style={node.fontStyle ?? "normal"} text-decoration={node.textDecoration === "strikethrough" ? "line-through" : node.textDecoration ?? "none"} letter-spacing={node.letterSpacing} text-anchor={node.textAlign === "left" ? "start" : node.textAlign === "center" ? "middle" : "end"}>
          {#each textLayout?.lines ?? [node.text] as line, index}<tspan x={textX(node, textLayout?.lineIndents[index] ?? 0)} y={textTop(node) + node.fontSize + (textLayout?.lineOffsets[index] ?? 0)}>{line || " "}</tspan>{/each}
        </text>
      {:else if node.type === "image"}
        <path d={cornerPath} fill="#333" />
        {#if imageSources[node.assetId]}
          <image href={imageSources[node.assetId]} width={node.width} height={node.height} preserveAspectRatio={node.fit === "fill" ? "none" : node.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} clip-path={`url(#image-clip-${node.id})`} />
        {/if}
        {#if node.stroke}<path d={cornerPath} fill="none" stroke={node.stroke.color} stroke-opacity={node.stroke.opacity} stroke-width={node.stroke.width} stroke-dasharray={node.stroke.dash?.join(" ")} />{/if}
      {:else if node.type === "icon" && icon}
        <g transform={`scale(${node.width / icon.width} ${node.height / icon.height})`} color={node.fill?.type === "solid" ? node.fill.color : "#fff"}>{@html icon.body}</g>
      {/if}
    </g>

    {#if node.type === "frame" || node.type === "group"}
      <g clip-path={node.type === "frame" && node.clipContent && !unclippedFrameIds.has(node.id) ? `url(#clip-${node.id})` : undefined}>
        {#each node.childIds as childId}
          {#if document.nodes[childId]}
            <CanvasNode node={document.nodes[childId]} {document} {selectedIds} {imageSources} {interactive} {preview} {unclippedFrameIds} {onNodePointerDown} {onNodeDoubleClick} {onNodeContextMenu} {onPrototypeClick} />
          {/if}
        {/each}
      </g>
    {/if}
  </g>
{/if}

<style>
  .prototype-link:hover { filter: brightness(1.08); }
</style>
