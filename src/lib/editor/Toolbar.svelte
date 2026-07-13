<script lang="ts">
  import {
    Circle, Frame, Hand, Image, Minus, MousePointer2, MoveRight, Pentagon, Plus,
    RectangleHorizontal, SquareTerminal, Star, Type, ZoomIn, ZoomOut,
  } from "lucide-svelte";
  import type { Tool } from "$lib/domain";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import { screenToWorld } from "$lib/geometry";

  let { session, onFit, terminalOpen, onToggleTerminal }: { session: EditorSession; onFit: () => void; terminalOpen: boolean; onToggleTerminal: () => void } = $props();
  let shapeMenu = $state(false);
  const shapeTools: { id: Tool; label: string; shortcut: string; icon: typeof RectangleHorizontal }[] = [
    { id: "rectangle", label: "Rectangle", shortcut: "R", icon: RectangleHorizontal },
    { id: "line", label: "Line", shortcut: "L", icon: Minus },
    { id: "arrow", label: "Arrow", shortcut: "⇧ L", icon: MoveRight },
    { id: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
    { id: "polygon", label: "Polygon", shortcut: "", icon: Pentagon },
    { id: "star", label: "Star", shortcut: "", icon: Star },
    { id: "image", label: "Image", shortcut: "⇧ ⌘ K", icon: Image },
  ];
  const selectedShape = $derived(shapeTools.find((tool) => tool.id === session.activeTool) ?? shapeTools[0]);

  function choose(tool: Tool) {
    session.setActiveTool(tool);
    shapeMenu = false;
  }

  function zoom(delta: number) {
    const viewport = session.document.viewport;
    const canvas = document.querySelector<HTMLElement>("#design-canvas");
    const point = { x: (canvas?.clientWidth ?? innerWidth) / 2, y: (canvas?.clientHeight ?? innerHeight) / 2 };
    const world = screenToWorld(point, viewport);
    const next = Math.max(.05, Math.min(8, viewport.zoom * delta));
    viewport.x = point.x - world.x * next;
    viewport.y = point.y - world.y * next;
    viewport.zoom = next;
    session.gestureChanged();
  }
</script>

<div class="toolbar-wrap">
  {#if shapeMenu}
    <div class="shape-menu">
      {#each shapeTools as tool}
        <button class:active={session.activeTool === tool.id} onclick={() => choose(tool.id)}>
          <tool.icon size={16} /><span>{tool.label}</span><kbd>{tool.shortcut}</kbd>
        </button>
      {/each}
    </div>
  {/if}
  <div class="toolbar" role="toolbar" aria-label="Design tools">
    <button class:active={session.activeTool === "select"} title="Move (V)" onclick={() => choose("select")}><MousePointer2 size={19} fill={session.activeTool === "select" ? "currentColor" : "none"} /></button>
    <button class:active={session.activeTool === "hand"} title="Hand (H)" onclick={() => choose("hand")}><Hand size={18} /></button>
    <span class="separator"></span>
    <button class:active={session.activeTool === "frame"} title="Frame (F)" onclick={() => choose("frame")}><Frame size={18} /></button>
    <div class="split-button">
      <button class:active={shapeTools.some((tool) => tool.id === session.activeTool)} title={selectedShape.label} onclick={() => choose(selectedShape.id)}><selectedShape.icon size={18} /></button>
      <button class="chevron" title="Shape tools" onclick={() => (shapeMenu = !shapeMenu)}>⌄</button>
    </div>
    <button class:active={session.activeTool === "text"} title="Text (T)" onclick={() => choose("text")}><Type size={19} /></button>
    <span class="separator"></span>
    <button title="Zoom out" onclick={() => zoom(.8)}><ZoomOut size={17} /></button>
    <button class="zoom" title="Fit selection" onclick={onFit}>{Math.round(session.document.viewport.zoom * 100)}%</button>
    <button title="Zoom in" onclick={() => zoom(1.25)}><ZoomIn size={17} /></button>
    <span class="separator"></span>
    <button class:active={terminalOpen} title="Toggle terminal (Ctrl + `)" onclick={onToggleTerminal}><SquareTerminal size={18} /></button>
  </div>
</div>

<style>
  .toolbar-wrap { position: absolute; z-index: 40; left: 50%; bottom: 10px; transform: translateX(-50%); }.toolbar { min-height: 49px; border: 1px solid #4a4a4a; border-radius: 10px; background: #252525; box-shadow: 0 4px 16px #0007; display: flex; align-items: center; padding: 5px 7px; gap: 2px; }
  .toolbar button { min-width: 36px; height: 37px; padding: 0 8px; border: 0; border-radius: 6px; color: #eee; background: transparent; display: grid; place-items: center; cursor: pointer; }.toolbar button:hover { background: #3a3a3a; }.toolbar button.active { background: #0d99ff; color: white; }.separator { width: 1px; height: 27px; background: #414141; margin: 0 4px; }.split-button { display: flex; }.split-button > button:first-child { border-radius: 6px 2px 2px 6px; }.split-button .chevron { min-width: 17px; width: 17px; padding: 0; border-radius: 2px 6px 6px 2px; font-size: 10px; }.toolbar .zoom { width: 45px; padding: 0; font-size: 9px; color: #bbb; }
  .shape-menu { position: absolute; width: 210px; bottom: 58px; left: 104px; background: #202020; border: 1px solid #414141; border-radius: 9px; padding: 6px; box-shadow: 0 12px 35px #0009; }.shape-menu button { width: 100%; height: 32px; border: 0; border-radius: 5px; background: transparent; color: #eee; display: flex; align-items: center; gap: 10px; padding: 0 9px; cursor: pointer; font-size: 10px; }.shape-menu button:hover,.shape-menu button.active { background: #343434; }.shape-menu span { flex: 1; text-align: left; }.shape-menu kbd { color: #888; font: inherit; }
</style>
