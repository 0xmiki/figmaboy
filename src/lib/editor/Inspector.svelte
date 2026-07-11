<script lang="ts">
  import {
    AlignCenter, AlignEndHorizontal, AlignHorizontalJustifyCenter, AlignStartHorizontal,
    ChevronDown, ChevronRight, Eye, Frame, Link2, Minus, Play, Plus, RotateCw,
  } from "lucide-svelte";
  import type { DesignNode, LayerEffect, Paint, TextNode } from "$lib/domain";
  import { solid } from "$lib/domain";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import { centerNodes } from "$lib/editor/editor-rpc";

  let { session, onCreatePreset, onPresent, onExport }: {
    session: EditorSession; onCreatePreset: (name: string, width: number, height: number) => void;
    onPresent: () => void; onExport: (format: "svg" | "png", scale?: number) => void;
  } = $props();
  let openSections = $state(new Set(["position", "appearance", "typography", "fill", "stroke", "prototype"]));
  const selected = $derived(session.selectedNodes);
  const node = $derived(selected.length === 1 ? selected[0] : null);
  const layerBlur = $derived(node?.effects?.find((effect) => effect.type === "layer-blur"));
  const supportsCornerRadius = $derived(node?.type === "rectangle" || node?.type === "frame" || node?.type === "image");
  const frames = $derived(Object.values(session.document.nodes).filter((item) => item.type === "frame"));
  const presets = [
    { category: "Phone", items: [["iPhone 17", 402, 874], ["iPhone 16 & 17 Pro", 402, 874], ["iPhone 16", 393, 852], ["iPhone 16 & 17 Pro Max", 440, 956], ["iPhone 16 Plus", 430, 932], ["Android Compact", 412, 917]] },
    { category: "Tablet", items: [["iPad mini", 744, 1133], ["iPad Pro 11\"", 834, 1194], ["Surface Pro", 912, 1368]] },
    { category: "Desktop", items: [["Desktop", 1440, 1024], ["MacBook Pro 14\"", 1512, 982], ["Desktop HD", 1920, 1080]] },
    { category: "Presentation", items: [["Slide 16:9", 1920, 1080], ["Slide 4:3", 1024, 768]] },
    { category: "Social media", items: [["Instagram post", 1080, 1080], ["X post", 1600, 900]] },
  ] as const;
  let expandedPresets = $state(new Set(["Phone"]));

  function toggle(section: string) {
    const next = new Set(openSections);
    next.has(section) ? next.delete(section) : next.add(section);
    openSections = next;
  }

  function update(patch: Partial<DesignNode>) { session.updateSelected(patch); }
  function textNumeric(key: "fontSize" | "lineHeight" | "letterSpacing", value: string) {
    if (!value.trim()) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = key === "fontSize" ? Math.max(1, parsed) : key === "lineHeight" ? Math.max(.1, parsed) : parsed;
    update({ [key]: next } as Partial<TextNode>);
  }
  function numeric(key: "x" | "y" | "width" | "height" | "rotation" | "opacity" | "radius", value: string, multiplier = 1) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const next = key === "radius" ? Math.max(0, parsed * multiplier) : parsed * multiplier;
      update({ [key]: next } as Partial<DesignNode>);
    }
  }
  function paintColor(paint: Paint | null): string { return paint?.type === "solid" ? paint.color : paint?.stops[0].color ?? "#a78bfa"; }

  function updateFillColor(color: string) {
    if (!node?.fill || node.fill.type === "solid") update({ fill: solid(color, node?.fill?.type === "solid" ? node.fill.opacity : 1) });
    else update({ fill: { ...node.fill, stops: node.fill.stops.map((stop, index) => index === 0 ? { ...stop, color } : stop) } });
  }

  function gradient(type: "linear-gradient" | "radial-gradient", color: string): Paint {
    const stops = [{ offset: 0, color, opacity: 1 }, { offset: 1, color: "#0d99ff", opacity: 1 }];
    return type === "linear-gradient" ? { type, angle: 0, stops } : { type, centerX: .5, centerY: .5, radius: .7, stops };
  }

  function updateGradientStop(index: number, color: string) {
    if (!node?.fill || node.fill.type === "solid") return;
    update({ fill: { ...node.fill, stops: node.fill.stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, color } : stop) } });
  }

  function updateCorner(key: "topLeft" | "topRight" | "bottomRight" | "bottomLeft", value: string) {
    if (!node) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const uniform = Math.max(0, node.radius);
    update({ cornerRadii: { topLeft: uniform, topRight: uniform, bottomRight: uniform, bottomLeft: uniform, ...node.cornerRadii, [key]: Math.max(0, parsed) } });
  }

  function updateLayerBlur(radius: number | null) {
    if (!node) return;
    const effects: LayerEffect[] = (node.effects ?? []).filter((effect) => effect.type !== "layer-blur");
    if (radius !== null) effects.push({ type: "layer-blur", radius: Math.max(0, radius) });
    update({ effects });
  }

  function align(kind: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    if (selected.length < 2) return;
    const left = Math.min(...selected.map((item) => item.x));
    const top = Math.min(...selected.map((item) => item.y));
    const right = Math.max(...selected.map((item) => item.x + item.width));
    const bottom = Math.max(...selected.map((item) => item.y + item.height));
    session.mutate(() => selected.forEach((item) => {
      if (kind === "left") item.x = left;
      if (kind === "center") item.x = (left + right - item.width) / 2;
      if (kind === "right") item.x = right - item.width;
      if (kind === "top") item.y = top;
      if (kind === "middle") item.y = (top + bottom - item.height) / 2;
      if (kind === "bottom") item.y = bottom - item.height;
    }));
  }

  function center(axis: "horizontal" | "vertical" | "both") {
    try { centerNodes(session, { ids: selected.map((item) => item.id), axis, relativeTo: "auto" }); }
    catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Could not center selection"; }
  }

  function presetCategory(category: string) {
    const next = new Set(expandedPresets);
    next.has(category) ? next.delete(category) : next.add(category);
    expandedPresets = next;
  }
</script>

<aside class="inspector" data-editor-inspector>
  <header class="top-controls">
    <div class="avatar">M</div><button class="play" title="Present prototype" onclick={onPresent}><Play size={16} fill="currentColor" /></button><button class="export" onclick={() => onExport("png", 1)}>Export</button>
  </header>
  <div class="tabs"><button class:active={session.inspectorTab === "design"} onclick={() => (session.inspectorTab = "design")}>Design</button><button class:active={session.inspectorTab === "prototype"} onclick={() => (session.inspectorTab = "prototype")}>Prototype</button><span>{Math.round(session.document.viewport.zoom * 100)}%</span></div>

  <div class="inspector-body">
    {#if session.inspectorTab === "prototype"}
      <div class="selection-title"><strong>{node ? node.name : "Prototype"}</strong><Link2 size={15} /></div>
      {#if node}
        <section>
          <button class="section-head" onclick={() => toggle("prototype")}><span>{openSections.has("prototype") ? "⌄" : "›"} Interaction</span>{#if !node.interaction}<Plus size={14} />{/if}</button>
          {#if openSections.has("prototype")}
            <div class="section-content">
              <label class="stacked"><span>On click</span><select value={node.interaction?.targetFrameId ?? ""} onchange={(event) => {
                const targetFrameId = event.currentTarget.value;
                update({ interaction: targetFrameId ? { trigger: "click", action: "navigate", targetFrameId } : undefined });
              }}><option value="">No action</option>{#each frames as frame}<option value={frame.id}>{frame.name}</option>{/each}</select></label>
              <p class="hint">Navigate to another frame on this page when this layer is clicked.</p>
            </div>
          {/if}
        </section>
        {#if node.type === "frame"}
          <section><div class="section-content"><label class="check"><input type="checkbox" checked={session.document.prototypeStartFrameId === node.id} onchange={(event) => session.mutate((document) => document.prototypeStartFrameId = event.currentTarget.checked ? node.id : null)} /> Set as flow starting point</label></div></section>
        {/if}
      {:else}
        <div class="empty-inspector"><Link2 size={24} /><p>Select a layer</p><span>Add click interactions and choose a starting frame.</span></div>
      {/if}
    {:else if session.activeTool === "frame" && !node}
      <div class="selection-title"><strong>Frame</strong><Frame size={15} /></div>
      <div class="preset-list">
        {#each presets as category}
          <button class="preset-category" onclick={() => presetCategory(category.category)}>{#if expandedPresets.has(category.category)}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}<span>{category.category}</span></button>
          {#if expandedPresets.has(category.category)}
            {#each category.items as item}<button class="preset-item" onclick={() => onCreatePreset(item[0], item[1], item[2])}><span>{item[0]}</span><small>{item[1]} × {item[2]}</small></button>{/each}
          {/if}
        {/each}
      </div>
    {:else if node || selected.length > 1}
      <div class="selection-title"><strong>{selected.length > 1 ? `${selected.length} layers` : node?.name}</strong><span>{selected.length === 1 ? node?.type : "Selection"}</span></div>
      <section>
        <button class="section-head" onclick={() => toggle("position")}><span>{openSections.has("position") ? "⌄" : "›"} Position</span></button>
        {#if openSections.has("position")}
          <div class="section-content">
            <div class="align-row"><button title="Align left" onclick={() => align("left")}><AlignStartHorizontal size={14} /></button><button title="Align center" onclick={() => align("center")}><AlignHorizontalJustifyCenter size={14} /></button><button title="Align right" onclick={() => align("right")}><AlignEndHorizontal size={14} /></button><button title="Align middle" onclick={() => align("middle")}><AlignCenter size={14} /></button></div>
            <div class="center-row"><span>Center</span><button title="Center horizontally" onclick={() => center("horizontal")}>H</button><button title="Center vertically" onclick={() => center("vertical")}>V</button><button title="Center on both axes" onclick={() => center("both")}>Both</button></div>
            {#if node}
              <div class="input-grid"><label><span>X</span><input value={Math.round(node.x * 10) / 10} onblur={(event) => numeric("x", event.currentTarget.value)} /></label><label><span>Y</span><input value={Math.round(node.y * 10) / 10} onblur={(event) => numeric("y", event.currentTarget.value)} /></label></div>
              <div class="input-grid"><label><span>W</span><input value={Math.round(node.width * 10) / 10} onblur={(event) => numeric("width", event.currentTarget.value)} /></label><label><span>H</span><input value={Math.round(node.height * 10) / 10} onblur={(event) => numeric("height", event.currentTarget.value)} /></label></div>
              <label class="wide-input"><RotateCw size={12} /><input value={Math.round(node.rotation * 10) / 10} onblur={(event) => numeric("rotation", event.currentTarget.value)} /><span>°</span></label>
            {/if}
          </div>
        {/if}
      </section>
      {#if node}
        <section>
          <button class="section-head" onclick={() => toggle("appearance")}><span>{openSections.has("appearance") ? "⌄" : "›"} Appearance</span><Eye size={14} /></button>
          {#if openSections.has("appearance")}
            <div class="section-content">
              <label class="property-input"><span>Opacity</span><div><input aria-label="Opacity" type="number" min="0" max="100" value={Math.round(node.opacity * 100)} onblur={(event) => numeric("opacity", event.currentTarget.value, .01)} /><em>%</em></div></label>
              <label class="stacked"><span>Blend mode</span><select value={node.blendMode ?? "normal"} onchange={(event) => update({ blendMode: event.currentTarget.value as DesignNode["blendMode"] })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option><option value="hard-light">Hard light</option><option value="difference">Difference</option><option value="color">Color</option><option value="luminosity">Luminosity</option></select></label>
              {#if supportsCornerRadius}
                <div class="radius-control">
                  <label class="property-input"><span>Corner radius</span><div><input aria-label="Corner radius" type="number" min="0" value={Math.round(node.radius * 10) / 10} onblur={(event) => update({ radius: Math.max(0, Number(event.currentTarget.value)), cornerRadii: undefined })} /><em>px</em></div></label>
                  <input class="radius-slider" aria-label="Corner radius slider" type="range" min="0" max={Math.max(64, Math.ceil(Math.min(Math.abs(node.width), Math.abs(node.height)) / 2))} value={node.radius} onchange={(event) => update({ radius: Math.max(0, Number(event.currentTarget.value)), cornerRadii: undefined })} />
                  <div class="input-grid"><label><span>TL</span><input aria-label="Top left radius" type="number" min="0" value={node.cornerRadii?.topLeft ?? node.radius} onblur={(event) => updateCorner("topLeft", event.currentTarget.value)} /></label><label><span>TR</span><input aria-label="Top right radius" type="number" min="0" value={node.cornerRadii?.topRight ?? node.radius} onblur={(event) => updateCorner("topRight", event.currentTarget.value)} /></label></div>
                  <div class="input-grid"><label><span>BL</span><input aria-label="Bottom left radius" type="number" min="0" value={node.cornerRadii?.bottomLeft ?? node.radius} onblur={(event) => updateCorner("bottomLeft", event.currentTarget.value)} /></label><label><span>BR</span><input aria-label="Bottom right radius" type="number" min="0" value={node.cornerRadii?.bottomRight ?? node.radius} onblur={(event) => updateCorner("bottomRight", event.currentTarget.value)} /></label></div>
                </div>
              {/if}
            </div>
          {/if}
        </section>
        {#if node.type === "text"}
          <section>
            <button class="section-head" onclick={() => toggle("typography")}><span>{openSections.has("typography") ? "⌄" : "›"} Typography</span></button>
            {#if openSections.has("typography")}
              <div class="section-content typography">
                <input class="font-family" aria-label="Font family" value={node.fontFamily} onblur={(event) => update({ fontFamily: event.currentTarget.value } as Partial<TextNode>)} />
                <div class="input-grid"><select value={node.fontWeight} onchange={(event) => update({ fontWeight: Number(event.currentTarget.value) } as Partial<TextNode>)}><option value="100">Thin</option><option value="300">Light</option><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option></select><label><input aria-label="Font size" type="number" min="1" step="1" value={node.fontSize} oninput={(event) => textNumeric("fontSize", event.currentTarget.value)} /><span>px</span></label></div>
                <div class="input-grid"><label><span>↕</span><input aria-label="Line height" type="number" min="0.1" step="0.1" value={node.lineHeight} oninput={(event) => textNumeric("lineHeight", event.currentTarget.value)} /></label><label><span>↔</span><input aria-label="Letter spacing" type="number" step="0.1" value={node.letterSpacing} oninput={(event) => textNumeric("letterSpacing", event.currentTarget.value)} /></label></div>
                <div class="segmented"><button class:active={node.textAlign === "left"} onclick={() => update({ textAlign: "left" } as Partial<TextNode>)}>Left</button><button class:active={node.textAlign === "center"} onclick={() => update({ textAlign: "center" } as Partial<TextNode>)}>Center</button><button class:active={node.textAlign === "right"} onclick={() => update({ textAlign: "right" } as Partial<TextNode>)}>Right</button></div>
                <div class="segmented"><button class:active={(node.fontStyle ?? "normal") === "normal"} onclick={() => update({ fontStyle: "normal" } as Partial<TextNode>)}>Regular</button><button class:active={node.fontStyle === "italic"} onclick={() => update({ fontStyle: "italic" } as Partial<TextNode>)}>Italic</button><button class:active={node.textDecoration === "underline"} onclick={() => update({ textDecoration: node.textDecoration === "underline" ? "none" : "underline" } as Partial<TextNode>)}>Underline</button><button class:active={node.textDecoration === "strikethrough"} onclick={() => update({ textDecoration: node.textDecoration === "strikethrough" ? "none" : "strikethrough" } as Partial<TextNode>)}>Strike</button></div>
                <div class="input-grid"><select aria-label="Text case" value={node.textCase ?? "original"} onchange={(event) => update({ textCase: event.currentTarget.value as TextNode["textCase"] } as Partial<TextNode>)}><option value="original">Original case</option><option value="upper">Uppercase</option><option value="lower">Lowercase</option><option value="title">Title case</option></select><select aria-label="Vertical alignment" value={node.textAlignVertical ?? "top"} onchange={(event) => update({ textAlignVertical: event.currentTarget.value as TextNode["textAlignVertical"] } as Partial<TextNode>)}><option value="top">Align top</option><option value="center">Align middle</option><option value="bottom">Align bottom</option></select></div>
                <div class="input-grid"><select aria-label="Text resize" value={node.textAutoResize ?? (node.autoWidth ? "width-and-height" : "height")} onchange={(event) => update({ textAutoResize: event.currentTarget.value as TextNode["textAutoResize"] } as Partial<TextNode>)}><option value="width-and-height">Auto width</option><option value="height">Auto height</option><option value="none">Fixed size</option></select><label><span>¶</span><input aria-label="Paragraph spacing" type="number" min="0" value={node.paragraphSpacing ?? 0} oninput={(event) => update({ paragraphSpacing: Math.max(0, Number(event.currentTarget.value)) } as Partial<TextNode>)} /></label></div>
              </div>
            {/if}
          </section>
        {/if}
        {#if node.type === "image"}
          <section><button class="section-head"><span>Image</span></button><div class="section-content"><div class="segmented"><button class:active={node.fit === "cover"} onclick={() => update({ fit: "cover" })}>Fill</button><button class:active={node.fit === "contain"} onclick={() => update({ fit: "contain" })}>Fit</button><button class:active={node.fit === "fill"} onclick={() => update({ fit: "fill" })}>Stretch</button></div><button class="full-button" onclick={() => update({ crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button></div></section>
        {/if}
        <section>
          <button class="section-head" onclick={() => toggle("fill")}><span>{openSections.has("fill") ? "⌄" : "›"} Fill</span>{#if !node.fill}<Plus size={14} onclick={(event) => { event.stopPropagation(); update({ fill: solid("#a78bfa") }); }} />{:else}<Minus size={14} onclick={(event) => { event.stopPropagation(); update({ fill: null }); }} />{/if}</button>
          {#if openSections.has("fill") && node.fill}<div class="section-content paint"><div class="paint-row"><input type="color" value={paintColor(node.fill)} oninput={(event) => updateFillColor(event.currentTarget.value)} /><input class="hex" value={paintColor(node.fill).replace("#", "").toUpperCase()} onblur={(event) => updateFillColor(`#${event.currentTarget.value.replace("#", "")}`)} /><select value={node.fill.type} onchange={(event) => update({ fill: event.currentTarget.value === "solid" ? solid(paintColor(node.fill)) : gradient(event.currentTarget.value as "linear-gradient" | "radial-gradient", paintColor(node.fill)) })}><option value="solid">Solid</option><option value="linear-gradient">Linear</option><option value="radial-gradient">Radial</option></select></div>{#if node.fill.type !== "solid"}<div class="gradient-stops">{#each node.fill.stops as stop, index}<label><input type="color" value={stop.color} oninput={(event) => updateGradientStop(index, event.currentTarget.value)} /><span>{Math.round(stop.offset * 100)}%</span></label>{/each}</div>{/if}{#if node.fill.type === "linear-gradient"}<label class="wide-input"><span>Angle</span><input value={node.fill.angle} onblur={(event) => update({ fill: { ...node.fill as Extract<Paint, { type: "linear-gradient" }>, angle: Number(event.currentTarget.value) } })} /><span>°</span></label>{:else if node.fill.type === "radial-gradient"}<div class="input-grid"><label><span>X</span><input aria-label="Gradient center X" type="number" step=".05" value={node.fill.centerX} onblur={(event) => update({ fill: { ...node.fill as Extract<Paint, { type: "radial-gradient" }>, centerX: Number(event.currentTarget.value) } })} /></label><label><span>Y</span><input aria-label="Gradient center Y" type="number" step=".05" value={node.fill.centerY} onblur={(event) => update({ fill: { ...node.fill as Extract<Paint, { type: "radial-gradient" }>, centerY: Number(event.currentTarget.value) } })} /></label></div><label class="wide-input"><span>Radius</span><input type="number" min="0" step=".05" value={node.fill.radius} onblur={(event) => update({ fill: { ...node.fill as Extract<Paint, { type: "radial-gradient" }>, radius: Math.max(0, Number(event.currentTarget.value)) } })} /></label>{/if}</div>{/if}
        </section>
        <section>
          <button class="section-head" onclick={() => toggle("stroke")}><span>{openSections.has("stroke") ? "⌄" : "›"} Stroke</span>{#if !node.stroke}<Plus size={14} onclick={(event) => { event.stopPropagation(); update({ stroke: { color: "#ffffff", opacity: 1, width: 1 } }); }} />{:else}<Minus size={14} onclick={(event) => { event.stopPropagation(); update({ stroke: null }); }} />{/if}</button>
          {#if openSections.has("stroke") && node.stroke}<div class="section-content paint"><div class="paint-row"><input type="color" value={node.stroke.color} oninput={(event) => update({ stroke: { ...node.stroke!, color: event.currentTarget.value } })} /><input class="hex" value={node.stroke.color.replace("#", "").toUpperCase()} /><label class="stroke-width"><input value={node.stroke.width} onblur={(event) => update({ stroke: { ...node.stroke!, width: Math.max(0, Number(event.currentTarget.value)) } })} /><span>px</span></label></div><div class="input-grid"><select aria-label="Stroke cap" value={node.stroke.cap ?? "butt"} onchange={(event) => update({ stroke: { ...node.stroke!, cap: event.currentTarget.value as NonNullable<DesignNode["stroke"]>["cap"] } })}><option value="butt">Butt cap</option><option value="round">Round cap</option><option value="square">Square cap</option></select><select aria-label="Stroke join" value={node.stroke.join ?? "miter"} onchange={(event) => update({ stroke: { ...node.stroke!, join: event.currentTarget.value as NonNullable<DesignNode["stroke"]>["join"] } })}><option value="miter">Miter join</option><option value="round">Round join</option><option value="bevel">Bevel join</option></select></div><label class="wide-input"><span>Dash</span><input placeholder="8 4" value={node.stroke.dash?.join(" ") ?? ""} onblur={(event) => update({ stroke: { ...node.stroke!, dash: event.currentTarget.value.trim() ? event.currentTarget.value.trim().split(/[ ,]+/).map(Number).filter((value) => Number.isFinite(value) && value >= 0) : undefined } })} /></label></div>{/if}
        </section>
        <section>
          <button class="section-head"><span>Effects</span>{#if !node.shadow}<Plus size={14} onclick={() => update({ shadow: { color: "#000000", opacity: .28, x: 0, y: 8, blur: 24 } })} />{:else}<Minus size={14} onclick={() => update({ shadow: null })} />{/if}</button>
          <div class="section-content">{#if node.shadow}<div class="input-grid"><label><span>X</span><input value={node.shadow.x} onblur={(event) => update({ shadow: { ...node.shadow!, x: Number(event.currentTarget.value) } })} /></label><label><span>Y</span><input value={node.shadow.y} onblur={(event) => update({ shadow: { ...node.shadow!, y: Number(event.currentTarget.value) } })} /></label></div><div class="input-grid"><label><span>Blur</span><input value={node.shadow.blur} onblur={(event) => update({ shadow: { ...node.shadow!, blur: Math.max(0, Number(event.currentTarget.value)) } })} /></label><label><span>%</span><input value={node.shadow.opacity * 100} onblur={(event) => update({ shadow: { ...node.shadow!, opacity: Math.max(0, Math.min(1, Number(event.currentTarget.value) / 100)) } })} /></label></div>{/if}{#if layerBlur?.type === "layer-blur"}<label class="property-input"><span>Layer blur</span><div><input type="number" min="0" value={layerBlur.radius} onblur={(event) => updateLayerBlur(Number(event.currentTarget.value))} /><em>px</em></div><button class="effect-remove" aria-label="Remove layer blur" onclick={() => updateLayerBlur(null)}>×</button></label>{:else}<button class="full-button" onclick={() => updateLayerBlur(8)}>+ Layer blur</button>{/if}</div>
        </section>
        <section><button class="section-head"><span>Export</span><Plus size={14} /></button><div class="section-content export-actions"><button onclick={() => onExport("png", 1)}>PNG 1×</button><button onclick={() => onExport("png", 2)}>PNG 2×</button><button onclick={() => onExport("svg")}>SVG</button></div></section>
      {/if}
    {:else}
      <div class="selection-title"><strong>Page</strong><span>{session.page.name}</span></div>
      <section><button class="section-head"><span>Canvas</span></button><div class="section-content"><div class="page-color"><span></span><code>626262</code><small>100%</small></div></div></section>
      <div class="empty-inspector"><Frame size={24} /><p>Start with a frame</p><span>Press F or choose the frame tool to see common device sizes.</span></div>
    {/if}
  </div>
</aside>

<style>
  .inspector { position: absolute; z-index: 30; inset: 0 0 0 auto; width: 241px; background: #292929; border-left: 1px solid #444; display: flex; flex-direction: column; }.top-controls { height: 42px; border-bottom: 1px solid #3d3d3d; display: flex; align-items: center; padding: 0 7px 0 11px; gap: 8px; }.avatar { width: 24px; height: 24px; border-radius: 50%; background: #64748b; display: grid; place-items: center; font-size: 10px; }.top-controls .play { margin-left: auto; background: transparent; border: 0; color: #eee; width: 31px; height: 29px; display: grid; place-items: center; border-radius: 5px; cursor: pointer; }.top-controls .play:hover { background: #3b3b3b; }.top-controls .export { height: 27px; border: 0; border-radius: 5px; background: #0d99ff; color: white; padding: 0 10px; font-size: 9px; font-weight: 600; cursor: pointer; }
  .tabs { height: 36px; border-bottom: 1px solid #3d3d3d; display: flex; align-items: center; padding: 0 7px; gap: 4px; }.tabs button { border: 0; border-radius: 4px; background: transparent; color: #999; height: 23px; padding: 0 8px; font-size: 9px; cursor: pointer; }.tabs button.active { background: #383838; color: white; }.tabs span { margin-left: auto; color: #ccc; font-size: 9px; padding-right: 4px; }
  .inspector-body { flex: 1; min-height: 0; overflow: auto; }.selection-title { min-height: 48px; border-bottom: 1px solid #3d3d3d; display: flex; align-items: center; padding: 0 14px; gap: 8px; }.selection-title strong { font-size: 10px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.selection-title span { color: #777; font-size: 8px; text-transform: capitalize; }
  section { border-bottom: 1px solid #3d3d3d; }.section-head { width: 100%; min-height: 40px; padding: 0 13px; border: 0; background: transparent; color: #eee; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 10px; font-weight: 600; }.section-head:hover { background: #2d2d2d; }.section-content { padding: 0 14px 13px; display: grid; gap: 7px; }
  .align-row, .segmented { display: flex; height: 25px; border-radius: 5px; overflow: hidden; background: #363636; }.align-row button, .segmented button { flex: 1; border: 0; border-right: 1px solid #424242; background: transparent; color: #ccc; display: grid; place-items: center; cursor: pointer; font-size: 8px; }.align-row button:hover, .segmented button:hover, .segmented button.active { background: #494949; color: white; }.center-row { display: grid; grid-template-columns: 1fr repeat(3, auto); align-items: center; gap: 4px; color: #999; font-size: 8px; }.center-row button { height: 24px; min-width: 30px; padding: 0 7px; border: 1px solid #444; border-radius: 4px; background: #363636; color: #ddd; font-size: 8px; cursor: pointer; }.center-row button:hover { border-color: #0d99ff; color: white; }
  .input-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }.input-grid label, .wide-input, .stroke-width { min-width: 0; height: 25px; border-radius: 4px; background: #363636; display: flex; align-items: center; padding: 0 7px; gap: 5px; color: #aaa; font-size: 8px; }.input-grid input, .wide-input input, .stroke-width input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #eee; font-size: 9px; }.wide-input span:first-child { min-width: 28px; }.section-content select { width: 100%; min-width: 0; height: 27px; border: 1px solid #444; border-radius: 4px; padding: 0 26px 0 7px; background-color: #353535; color: #eee; font-size: 9px; }
  .property-input { min-height: 29px; display: flex; align-items: center; justify-content: space-between; gap: 9px; color: #bcbcc1; font-size: 9px; }.property-input > span { white-space: nowrap; }.property-input > div { width: 76px; height: 27px; display: flex; align-items: center; padding: 0 7px; gap: 3px; border-radius: 4px; background: #363636; }.property-input input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #eee; text-align: right; font-size: 9px; appearance: textfield; -moz-appearance: textfield; }.property-input input::-webkit-inner-spin-button { display: none; }.property-input em { color: #8b8b91; font-size: 8px; font-style: normal; }.radius-control { display: grid; gap: 5px; padding-top: 2px; }.radius-slider { width: 100%; height: 12px; margin: 0; accent-color: #0d99ff; cursor: pointer; }
  .paint-row { display: flex; gap: 6px; }.paint-row input[type="color"] { width: 27px; height: 25px; border: 0; padding: 2px; background: #3a3a3a; border-radius: 4px; }.paint-row .hex { min-width: 0; flex: 1; height: 25px; border: 0; border-radius: 4px; background: #363636; color: #eee; padding: 0 7px; font-size: 9px; }.paint-row select { width: 62px; }.stroke-width { width: 50px; }
  .typography { gap: 7px; }.font-family { width: 100%; box-sizing: border-box; height: 27px; border: 1px solid #444; border-radius: 4px; padding: 0 7px; background: #353535; color: #eee; font-size: 9px; }.gradient-stops { display: flex; flex-wrap: wrap; gap: 6px; }.gradient-stops label { height: 25px; display: flex; align-items: center; gap: 4px; padding-right: 6px; border-radius: 4px; background: #363636; color: #aaa; font-size: 8px; }.gradient-stops input { width: 26px; height: 25px; padding: 2px; border: 0; background: transparent; }.effect-remove { border: 0; background: transparent; color: #aaa; cursor: pointer; }.full-button { height: 27px; border: 1px solid #444; background: #343434; color: #ddd; border-radius: 5px; font-size: 9px; cursor: pointer; }.hint { color: #777; font-size: 8px; line-height: 1.45; margin: 1px 0; }.stacked { display: grid; gap: 5px; color: #aaa; font-size: 8px; }.check { display: flex; align-items: center; gap: 7px; color: #ddd; font-size: 9px; }.check input { accent-color: #0d99ff; }
  .export-actions { grid-template-columns: repeat(3,1fr); }.export-actions button { border: 1px solid #454545; background: #343434; color: #ddd; border-radius: 4px; height: 28px; font-size: 8px; cursor: pointer; }.export-actions button:hover { border-color: #0d99ff; }
  .page-color { height: 26px; background: #353535; border-radius: 4px; display: flex; align-items: center; padding: 0 7px; gap: 7px; }.page-color span { width: 14px; height: 14px; border-radius: 2px; background: #626262; }.page-color code { font: 9px inherit; flex: 1; }.page-color small { font-size: 8px; }
  .empty-inspector { height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #696970; text-align: center; padding: 20px; }.empty-inspector p { color: #aaa; font-size: 10px; margin: 9px 0 3px; }.empty-inspector span { font-size: 8px; line-height: 1.5; }
  .preset-list { padding: 6px 0 14px; }.preset-category { width: 100%; height: 34px; border: 0; background: transparent; color: #ddd; display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 9px; cursor: pointer; }.preset-category:hover { background: #343434; }.preset-item { width: 100%; height: 32px; border: 0; background: transparent; color: #ddd; display: flex; justify-content: space-between; align-items: center; padding: 0 14px 0 26px; cursor: pointer; font-size: 9px; }.preset-item:hover { background: #383838; }.preset-item small { color: #777; font-size: 8px; }
</style>
