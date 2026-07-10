<script lang="ts">
  import { ArrowLeft, Maximize2, X } from "lucide-svelte";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";

  let { session, onClose }: { session: EditorSession; onClose: () => void } = $props();
  const availableFrames = $derived(Object.values(session.document.nodes).filter((node) => node.type === "frame"));
  let currentFrameId = $state<string | null>(null);
  let history = $state<string[]>([]);
  const frame = $derived(currentFrameId ? session.document.nodes[currentFrameId] : null);

  $effect(() => {
    if (!currentFrameId) currentFrameId = session.document.prototypeStartFrameId ?? availableFrames[0]?.id ?? null;
  });

  function activate(id: string) {
    const node = session.document.nodes[id];
    const target = node?.interaction?.targetFrameId;
    if (target && session.document.nodes[target]?.type === "frame") {
      if (currentFrameId) history = [...history, currentFrameId];
      currentFrameId = target;
    }
  }

  function back() {
    const next = history.at(-1);
    if (!next) return;
    currentFrameId = next;
    history = history.slice(0, -1);
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowLeft" && (event.metaKey || event.altKey)) back(); }} />

<div class="preview">
  <header><div class="preview-brand"><span></span><strong>{session.file.name}</strong><small>Prototype preview</small></div><div class="preview-actions"><button onclick={back} disabled={history.length === 0} title="Back"><ArrowLeft size={17} /></button><button title="Fit to screen"><Maximize2 size={16} /></button><button class="close" onclick={onClose}><X size={18} /> Close</button></div></header>
  <main>
    {#if frame?.type === "frame"}
      <svg viewBox={`${frame.x} ${frame.y} ${Math.max(1, frame.width)} ${Math.max(1, frame.height)}`} preserveAspectRatio="xMidYMid meet">
        <CanvasNode node={frame} document={session.document} selectedIds={[]} imageSources={session.imageSources} interactive={false} preview={true} onPrototypeClick={activate} />
      </svg>
      <div class="flow-label">{frame.name}</div>
    {:else}
      <div class="no-flow"><div><Maximize2 size={28} /></div><h2>No frames to present</h2><p>Create a frame and mark it as the flow starting point in the Prototype tab.</p><button onclick={onClose}>Back to editor</button></div>
    {/if}
  </main>
</div>

<style>
  .preview { position: fixed; z-index: 200; inset: 0; background: #151515; display: flex; flex-direction: column; }.preview header { height: 54px; padding: 0 13px 0 17px; border-bottom: 1px solid #333; background: #232323; display: flex; align-items: center; }.preview-brand { display: grid; grid-template-columns: 9px auto; column-gap: 9px; align-items: center; }.preview-brand > span { grid-row: span 2; width: 9px; height: 18px; border-radius: 5px 5px 2px 5px; background: linear-gradient(#f24e1e 0 33%,#a259ff 33% 66%,#1abcfe 66%); }.preview-brand strong { font-size: 11px; }.preview-brand small { font-size: 8px; color: #777; margin-top: 2px; }.preview-actions { margin-left: auto; display: flex; gap: 6px; }.preview-actions button { height: 31px; min-width: 31px; border: 1px solid #414141; border-radius: 6px; background: #2d2d2d; color: #ddd; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 9px; cursor: pointer; }.preview-actions button:disabled { opacity: .35; cursor: default; }.preview-actions .close { padding: 0 10px; }.preview main { flex: 1; min-height: 0; position: relative; padding: 38px; background: #111; }.preview svg { width: 100%; height: 100%; filter: drop-shadow(0 20px 50px #000b); }.flow-label { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: #262626; border: 1px solid #414141; border-radius: 6px; padding: 5px 9px; color: #aaa; font-size: 8px; }.no-flow { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.no-flow > div { width: 62px; height: 62px; display: grid; place-items: center; border: 1px solid #3d3d3d; border-radius: 15px; color: #777; }.no-flow h2 { font-size: 16px; margin: 17px 0 5px; }.no-flow p { max-width: 330px; color: #777; font-size: 10px; line-height: 1.5; }.no-flow button { margin-top: 12px; height: 31px; padding: 0 12px; border: 0; border-radius: 6px; background: #0d99ff; color: white; cursor: pointer; font-size: 10px; }
</style>
