<script lang="ts">
  import {
    Box, File, Layers3, MoreHorizontal, Plus, Search, Shapes, SlidersHorizontal, X,
  } from "lucide-svelte";
  import type { DesignNode } from "$lib/domain";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import { iconData, searchIcons } from "$lib/icon-catalog";
  import LayerRow from "$lib/editor/LayerRow.svelte";

  let {
    session, onCreatePage, onOpenPage, onPageMenu, onLayerContext, onPlaceIcon,
  }: {
    session: EditorSession; onCreatePage: () => void; onOpenPage: (id: string) => void;
    onPageMenu: (event: MouseEvent, id: string) => void; onLayerContext: (event: MouseEvent, id: string) => void;
    onPlaceIcon: (name: string) => void;
  } = $props();
  let query = $state("");
  let expandedIds = $state(new Set<string>());
  const icons = $derived(searchIcons(query));

  function toggleExpanded(id: string) {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedIds = next;
  }

  function updateNode(id: string, patch: Partial<DesignNode>) {
    session.mutate((document) => { const node = document.nodes[id]; if (node) Object.assign(node, patch); });
  }

  function renameLayer(id: string) {
    const node = session.document.nodes[id];
    if (!node) return;
    const name = prompt("Layer name", node.name)?.trim();
    if (name) updateNode(id, { name });
  }

  function dropNode(draggedId: string, targetId: string) {
    const dragged = session.document.nodes[draggedId];
    const target = session.document.nodes[targetId];
    if (!dragged || !target) return;
    session.mutate((document) => {
      const current = document.nodes[draggedId];
      if (!current) return;
      if (current.parentId) {
        const parent = document.nodes[current.parentId];
        if (parent?.type === "frame" || parent?.type === "group") parent.childIds = parent.childIds.filter((id) => id !== draggedId);
      } else document.rootIds = document.rootIds.filter((id) => id !== draggedId);
      if (target.type === "frame" || target.type === "group") {
        current.parentId = target.id;
        current.x -= target.x;
        current.y -= target.y;
        target.childIds.push(draggedId);
        expandedIds = new Set([...expandedIds, target.id]);
      } else {
        current.parentId = target.parentId;
        const list = target.parentId ? (document.nodes[target.parentId] as Extract<DesignNode, { type: "frame" | "group" }>).childIds : document.rootIds;
        list.splice(Math.max(0, list.indexOf(target.id)), 0, draggedId);
      }
    });
  }
</script>

<aside class="left-shell">
  <nav class="rail" aria-label="Editor panels">
    <div class="figma-mark"><span></span><span></span><span></span></div>
    <button class:active={session.leftTab === "file"} title="File" onclick={() => (session.leftTab = "file")}><File size={17} /><span>File</span></button>
    <button class:active={session.leftTab === "assets"} title="Assets" onclick={() => (session.leftTab = "assets")}><Shapes size={17} /><span>Assets</span></button>
  </nav>

  <section class="panel">
    {#if session.leftTab === "file"}
      <header><strong>{session.file.name}</strong><MoreHorizontal size={15} /></header>
      <div class="section-title"><span>Pages</span><div><button title="Search pages"><Search size={13} /></button><button title="New page" onclick={onCreatePage}><Plus size={14} /></button></div></div>
      <div class="pages">
        {#each session.pages as page}
          <button class:active={page.id === session.page.id} onclick={() => onOpenPage(page.id)} oncontextmenu={(event) => onPageMenu(event, page.id)}><span>{page.name}</span><MoreHorizontal size={13} /></button>
        {/each}
      </div>
      <div class="divider"></div>
      <div class="section-title"><span>Layers</span><button title="Layer options"><SlidersHorizontal size={13} /></button></div>
      <div class="layers" role="tree">
        {#each [...session.document.rootIds].reverse() as id}
          {#if session.document.nodes[id]}
            <LayerRow node={session.document.nodes[id]} document={session.document} selectedIds={session.selectedIds} {expandedIds} onSelect={(id, additive) => session.select(id, additive)} onToggleExpanded={toggleExpanded} onToggleVisible={(id) => updateNode(id, { visible: !session.document.nodes[id].visible })} onToggleLock={(id) => updateNode(id, { locked: !session.document.nodes[id].locked })} onRename={renameLayer} onContextMenu={onLayerContext} onDropNode={dropNode} />
          {/if}
        {/each}
        {#if session.document.rootIds.length === 0}<div class="layers-empty"><Layers3 size={22} /><p>No layers yet</p><span>Choose a tool and draw on the canvas.</span></div>{/if}
      </div>
    {:else}
      <header><strong>Assets</strong><Box size={15} /></header>
      <div class="asset-search"><Search size={14} /><input bind:value={query} placeholder="Search {icons.length > 0 ? 'icons' : 'assets'}" />{#if query}<button onclick={() => (query = "")}><X size={13} /></button>{/if}</div>
      <div class="asset-copy"><strong>Lucide icons</strong><span>Click an icon to place it in the center of your canvas.</span></div>
      <div class="icon-grid">
        {#each icons as name}
          {@const icon = iconData(name)}
          <button title={name} onclick={() => onPlaceIcon(name)}>{#if icon}<svg viewBox={`0 0 ${icon.width} ${icon.height}`} aria-hidden="true">{@html icon.body}</svg>{/if}<span>{name}</span></button>
        {/each}
      </div>
      {#if icons.length === 0}<div class="layers-empty"><Search size={22} /><p>No icons found</p><span>Try a shorter search term.</span></div>{/if}
    {/if}
  </section>
</aside>

<style>
  .left-shell { position: absolute; inset: 0 auto 0 0; width: 297px; z-index: 30; display: grid; grid-template-columns: 56px 241px; background: #292929; border-right: 1px solid #444; }.rail { border-right: 1px solid #3c3c3c; display: flex; flex-direction: column; align-items: center; padding-top: 8px; gap: 8px; }.figma-mark { width: 35px; height: 34px; position: relative; margin-bottom: 2px; border-bottom: 1px solid #3b3b3b; }.figma-mark span { position: absolute; width: 7px; height: 7px; border: 1.5px solid white; border-radius: 50%; left: 11px; top: 7px; }.figma-mark span:nth-child(2) { left: 18px; border-radius: 50% 50% 50% 0; }.figma-mark span:nth-child(3) { top: 14px; border-radius: 50% 0 50% 50%; }
  .rail button { width: 42px; min-height: 48px; border: 0; border-radius: 6px; background: transparent; color: #ddd; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 8px; cursor: pointer; }.rail button:hover { background: #333; }.rail button.active { background: #3e4d70; color: white; }
  .panel { min-width: 0; overflow: hidden; display: flex; flex-direction: column; }.panel > header { height: 56px; padding: 0 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #3b3b3b; }.panel > header strong { font-size: 11px; max-width: 180px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
  .section-title { height: 38px; padding: 0 10px 0 15px; display: flex; align-items: center; justify-content: space-between; color: #ddd; font-size: 10px; font-weight: 600; }.section-title div { display: flex; }.section-title button { border: 0; background: transparent; color: #bbb; width: 25px; height: 25px; display: grid; place-items: center; border-radius: 4px; cursor: pointer; }.section-title button:hover { background: #3b3b3b; color: white; }
  .pages { padding: 0 6px 7px; }.pages button { width: 100%; height: 31px; border: 0; border-radius: 4px; background: transparent; color: #ddd; padding: 0 7px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; cursor: pointer; }.pages button :global(svg) { opacity: 0; }.pages button:hover { background: #343434; }.pages button:hover :global(svg) { opacity: 1; }.pages button.active { background: #383838; color: white; }
  .divider { height: 1px; background: #3b3b3b; }.layers { flex: 1; min-height: 0; overflow: auto; padding: 2px 0 12px; }.layers-empty { height: 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #67676d; text-align: center; padding: 20px; }.layers-empty p { color: #aaa; font-size: 11px; margin: 9px 0 3px; }.layers-empty span { font-size: 9px; line-height: 1.45; }
  .asset-search { margin: 9px 11px; height: 31px; border-radius: 6px; background: #383838; display: flex; align-items: center; gap: 6px; padding: 0 8px; color: #aaa; }.asset-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: white; font-size: 10px; }.asset-search button { border: 0; background: transparent; color: #aaa; padding: 0; display: grid; cursor: pointer; }
  .asset-copy { padding: 3px 13px 10px; display: flex; flex-direction: column; }.asset-copy strong { font-size: 10px; }.asset-copy span { margin-top: 3px; color: #777; font-size: 8px; line-height: 1.4; }.icon-grid { padding: 0 10px 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; overflow: auto; }.icon-grid button { min-width: 0; height: 98px; border: 0; background: #f5f5f5; color: #222; border-radius: 5px; padding: 12px 6px 7px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; cursor: pointer; }.icon-grid button:hover { box-shadow: inset 0 0 0 2px #0d99ff; }.icon-grid svg { width: 43px; height: 43px; }.icon-grid span { width: 100%; font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
