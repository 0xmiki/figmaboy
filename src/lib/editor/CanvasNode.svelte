<script lang="ts">
  import type { DesignNode, PageDocument, TextNode } from "$lib/domain";
  import { iconData } from "$lib/icon-catalog";
  import { polygonPoints } from "$lib/geometry";
  import { layoutText } from "$lib/text-layout";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";

  let {
    node, document, selectedIds, imageSources, interactive = true, preview = false, unclippedFrameIds = new Set<string>(),
    onNodePointerDown, onNodeDoubleClick, onPrototypeClick,
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
    onPrototypeClick?: (id: string) => void;
  } = $props();

  const fillValue = $derived(node.fill ? node.fill.type === "solid" ? node.fill.color : `url(#fill-${node.id})` : "none");
  const fillOpacity = $derived(node.fill?.type === "solid" ? node.fill.opacity : 1);
  const strokeValue = $derived(node.stroke?.color ?? "none");
  const icon = $derived(node.type === "icon" ? iconData(node.iconName) : null);
  const textLayout = $derived(node.type === "text" ? layoutText(node) : null);

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

  function keyActivate(event: KeyboardEvent) {
    if (preview && node.interaction && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onPrototypeClick?.(node.id);
    }
  }

  function textX(text: TextNode): number {
    return text.textAlign === "left" ? 0 : text.textAlign === "center" ? text.width / 2 : text.width;
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
    onclick={click}
    onkeydown={keyActivate}
    role="button"
    aria-label={node.name}
    tabindex={preview && node.interaction ? 0 : -1}
    style:cursor={preview && node.interaction ? "pointer" : node.locked ? "not-allowed" : "default"}
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
      {#if node.shadow}
        <filter id={`shadow-${node.id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx={node.shadow.x} dy={node.shadow.y} stdDeviation={node.shadow.blur / 2} flood-color={node.shadow.color} flood-opacity={node.shadow.opacity} />
        </filter>
      {/if}
      {#if node.type === "frame" && node.clipContent}<clipPath id={`clip-${node.id}`}><rect width={node.width} height={node.height} rx={node.radius} /></clipPath>{/if}
      {#if node.type === "image"}<clipPath id={`image-clip-${node.id}`}><rect width={node.width} height={node.height} rx={Math.min(node.radius, node.width / 2, node.height / 2)} /></clipPath>{/if}
      {#if node.type === "arrow"}
        <marker id={`arrow-${node.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={strokeValue} /></marker>
      {/if}
    </defs>

    <g filter={node.shadow ? `url(#shadow-${node.id})` : undefined}>
      {#if node.type === "rectangle" || node.type === "frame"}
        <rect width={node.width} height={node.height} rx={Math.min(node.radius, node.width / 2, node.height / 2)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 0} stroke-dasharray={node.stroke?.dash?.join(" ")} />
      {:else if node.type === "group"}
        <rect width={Math.max(1, node.width)} height={Math.max(1, node.height)} fill="transparent" stroke="transparent" />
      {:else if node.type === "ellipse"}
        <ellipse cx={node.width / 2} cy={node.height / 2} rx={Math.abs(node.width / 2)} ry={Math.abs(node.height / 2)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 0} />
      {:else if node.type === "line" || node.type === "arrow"}
        <line x1="0" y1="0" x2={node.width} y2={node.height} fill="none" stroke={strokeValue} stroke-opacity={node.stroke?.opacity ?? 1} stroke-width={node.stroke?.width ?? 2} stroke-linecap="round" marker-end={node.type === "arrow" ? `url(#arrow-${node.id})` : undefined} />
      {:else if node.type === "polygon"}
        <polygon points={polygonPoints(node.width, node.height, node.points ?? 6)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} />
      {:else if node.type === "star"}
        <polygon points={polygonPoints(node.width, node.height, node.points ?? 5, .44)} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} />
      {:else if node.type === "text"}
        <rect width={Math.max(1, node.width)} height={textLayout?.height ?? node.height} fill="transparent" />
        <text x={textX(node)} y={node.fontSize} fill={fillValue} fill-opacity={fillOpacity} stroke={strokeValue} stroke-width={node.stroke?.width ?? 0} font-family={node.fontFamily} font-size={node.fontSize} font-weight={node.fontWeight} letter-spacing={node.letterSpacing} text-anchor={node.textAlign === "left" ? "start" : node.textAlign === "center" ? "middle" : "end"}>
          {#each textLayout?.lines ?? [node.text] as line, index}<tspan x={textX(node)} dy={index === 0 ? 0 : textLayout?.lineHeight}>{line || " "}</tspan>{/each}
        </text>
      {:else if node.type === "image"}
        <rect width={node.width} height={node.height} rx={Math.min(node.radius, node.width / 2, node.height / 2)} fill="#333" />
        {#if imageSources[node.assetId]}
          <image href={imageSources[node.assetId]} width={node.width} height={node.height} preserveAspectRatio={node.fit === "fill" ? "none" : node.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} clip-path={`url(#image-clip-${node.id})`} />
        {/if}
        {#if node.stroke}<rect width={node.width} height={node.height} rx={Math.min(node.radius, node.width / 2, node.height / 2)} fill="none" stroke={node.stroke.color} stroke-opacity={node.stroke.opacity} stroke-width={node.stroke.width} />{/if}
      {:else if node.type === "icon" && icon}
        <g transform={`scale(${node.width / icon.width} ${node.height / icon.height})`} color={node.fill?.type === "solid" ? node.fill.color : "#fff"}>{@html icon.body}</g>
      {/if}
    </g>

    {#if node.type === "frame" || node.type === "group"}
      <g clip-path={node.type === "frame" && node.clipContent && !unclippedFrameIds.has(node.id) ? `url(#clip-${node.id})` : undefined}>
        {#each node.childIds as childId}
          {#if document.nodes[childId]}
            <CanvasNode node={document.nodes[childId]} {document} {selectedIds} {imageSources} {interactive} {preview} {unclippedFrameIds} {onNodePointerDown} {onNodeDoubleClick} {onPrototypeClick} />
          {/if}
        {/each}
      </g>
    {/if}
  </g>
{/if}

<style>
  .prototype-link:hover { filter: brightness(1.08); }
</style>
