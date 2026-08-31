<script lang="ts">
  import { CornersOut, Minus, Plus, X } from "phosphor-svelte";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";
  import type { EditorSession } from "$lib/editor/editor.svelte";

  let { session, frameId, onClose }: { session: EditorSession; frameId: string; onClose: () => void } = $props();
  let zoom = $state(1);
  const frame = $derived(session.document.nodes[frameId]);
  const viewBox = $derived.by(() => {
    if (!frame || frame.type !== "frame") return "0 0 1 1";
    const width = Math.max(1, frame.width / zoom);
    const height = Math.max(1, frame.height / zoom);
    return `${frame.x + (frame.width - width) / 2} ${frame.y + (frame.height - height) / 2} ${width} ${height}`;
  });

  function setZoom(value: number) {
    zoom = Math.max(0.25, Math.min(4, Math.round(value * 100) / 100));
  }
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onClose()} />

<div class="fullscreen-preview" role="dialog" aria-modal="true" aria-label={`Fullscreen preview of ${frame?.name ?? "frame"}`}>
  <header>
    <div><strong>{frame?.name ?? "Frame"}</strong><small>Fullscreen</small></div>
    <nav aria-label="Preview zoom controls">
      <button aria-label="Zoom out" title="Zoom out" onclick={() => setZoom(zoom - 0.25)} disabled={zoom <= 0.25}><Minus size={14} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" title="Zoom in" onclick={() => setZoom(zoom + 0.25)} disabled={zoom >= 4}><Plus size={14} /></button>
      <button aria-label="Fit frame" title="Fit frame" onclick={() => setZoom(1)}><CornersOut size={14} /></button>
      <button class="close" aria-label="Close fullscreen" title="Close" onclick={onClose}><X size={16} /></button>
    </nav>
  </header>
  <main onwheel={(event) => { event.preventDefault(); setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1)); }}>
    {#if frame?.type === "frame"}
      <svg {viewBox} preserveAspectRatio="xMidYMid meet" aria-label={frame.name}>
        <CanvasNode node={frame} document={session.document} selectedIds={[]} imageSources={session.imageSources} interactive={false} />
      </svg>
    {:else}
      <p>This frame is no longer available.</p>
    {/if}
  </main>
</div>

<style>
  .fullscreen-preview { position: fixed; z-index: 220; inset: 0; display: flex; flex-direction: column; background: #171717; color: #ececef; }
  header { height: 48px; flex: 0 0 48px; padding: 0 9px 0 14px; border-bottom: 1px solid #373737; background: #242424; display: flex; align-items: center; box-shadow: 0 4px 18px #0005; }
  header > div { min-width: 0; display: grid; gap: 1px; }
  header strong { overflow: hidden; font-size: var(--text-body); font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
  header small { color: #85858c; font-size: var(--text-caption); }
  nav { margin-left: auto; display: flex; align-items: center; gap: 3px; }
  nav button { width: 30px; height: 30px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: #aaaab1; display: grid; place-items: center; cursor: pointer; }
  nav button:hover { background: #363636; color: #f4f4f5; }
  nav button:disabled { opacity: .35; cursor: default; }
  nav span { min-width: 46px; color: #929299; font: var(--text-caption)/1 var(--font-code); text-align: center; }
  nav .close { margin-left: 5px; }
  main { min-height: 0; flex: 1; padding: 32px; display: grid; place-items: center; overflow: hidden; background: #111; overscroll-behavior: contain; }
  svg { width: 100%; height: 100%; filter: drop-shadow(0 18px 45px #000a); }
  main p { color: #85858c; font-size: var(--text-body); }
</style>
