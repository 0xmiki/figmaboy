<script lang="ts">
  import {
    ChevronDown, ChevronRight, Circle, Eye, EyeOff, Frame, Group, Image, Lock, Minus,
    MousePointer2, Square, Star, Type, Unlock,
  } from "lucide-svelte";
  import type { DesignNode, PageDocument } from "$lib/domain";
  import LayerRow from "$lib/editor/LayerRow.svelte";

  let {
    node, document, selectedIds, depth = 0, expandedIds, onSelect, onToggleExpanded, onToggleVisible,
    onToggleLock, onRename, onContextMenu, onDropNode,
  }: {
    node: DesignNode; document: PageDocument; selectedIds: string[]; depth?: number; expandedIds: Set<string>;
    onSelect: (id: string, additive: boolean) => void; onToggleExpanded: (id: string) => void;
    onToggleVisible: (id: string) => void; onToggleLock: (id: string) => void; onRename: (id: string) => void;
    onContextMenu: (event: MouseEvent, id: string) => void; onDropNode: (draggedId: string, targetId: string) => void;
  } = $props();
  const isContainer = $derived(node.type === "frame" || node.type === "group");
  const container = $derived(node.type === "frame" || node.type === "group" ? node : null);
  const expanded = $derived(expandedIds.has(node.id));

  function iconForNode() {
    if (node.type === "frame") return Frame;
    if (node.type === "group") return Group;
    if (node.type === "text") return Type;
    if (node.type === "image") return Image;
    if (node.type === "ellipse") return Circle;
    if (node.type === "line" || node.type === "arrow") return Minus;
    if (node.type === "star") return Star;
    if (node.type === "icon") return MousePointer2;
    return Square;
  }
  const Icon = $derived(iconForNode());
</script>

<div
  class="layer-row" class:selected={selectedIds.includes(node.id)} class:hidden={!node.visible}
  style:padding-left={`${8 + depth * 15}px`} role="treeitem" aria-selected={selectedIds.includes(node.id)}
  draggable="true" ondragstart={(event) => event.dataTransfer?.setData("text/figmaboy-node", node.id)}
  ondragover={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; }}
  ondrop={(event) => { event.preventDefault(); const id = event.dataTransfer?.getData("text/figmaboy-node"); if (id && id !== node.id) onDropNode(id, node.id); }}
  tabindex="0" onclick={(event) => onSelect(node.id, event.shiftKey)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id, event.shiftKey); } }} ondblclick={() => onRename(node.id)} oncontextmenu={(event) => onContextMenu(event, node.id)}
>
  {#if isContainer}<button class="disclosure" onclick={(event) => { event.stopPropagation(); onToggleExpanded(node.id); }}>{#if expanded}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}</button>{:else}<span class="disclosure-space"></span>{/if}
  <Icon size={13} strokeWidth={1.6} />
  <span class="name">{node.name}</span>
  <div class="layer-actions">
    {#if node.locked}<button title="Unlock" onclick={(event) => { event.stopPropagation(); onToggleLock(node.id); }}><Lock size={12} /></button>{:else}<button class="hover-only" title="Lock" onclick={(event) => { event.stopPropagation(); onToggleLock(node.id); }}><Unlock size={12} /></button>{/if}
    <button class:hover-only={node.visible} title={node.visible ? "Hide" : "Show"} onclick={(event) => { event.stopPropagation(); onToggleVisible(node.id); }}>{#if node.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}</button>
  </div>
</div>

{#if container && expanded}
  {#each container.childIds as childId}
    {#if document.nodes[childId]}
      <LayerRow node={document.nodes[childId]} {document} {selectedIds} depth={depth + 1} {expandedIds} {onSelect} {onToggleExpanded} {onToggleVisible} {onToggleLock} {onRename} {onContextMenu} {onDropNode} />
    {/if}
  {/each}
{/if}

<style>
  .layer-row { height: 31px; display: flex; align-items: center; gap: 7px; padding-right: 6px; color: #d0d0d4; font-size: 11px; border-radius: 4px; margin: 0 5px; cursor: default; }.layer-row:hover { background: #343434; }.layer-row.selected { background: #39486d; color: white; }.layer-row.hidden { color: #74747b; }
  .disclosure, .layer-actions button { width: 20px; height: 24px; padding: 0; border: 0; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }.disclosure-space { width: 20px; }.name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.layer-actions { display: flex; margin-left: auto; }.hover-only { opacity: 0; }.layer-row:hover .hover-only, .layer-row.selected .hover-only { opacity: .8; }
</style>
