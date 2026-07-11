<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import { ChevronDown, ChevronLeft, Copy, Eye, EyeOff, Group, Lock, MoveDown, MoveUp, PanelLeftClose, PanelRightClose, RefreshCw, Save, Trash2, Ungroup, Unlock, X } from "lucide-svelte";
  import type { DesignNode, PageMeta } from "$lib/domain";
  import { cloneDocument, defaultNode } from "$lib/domain";
  import { screenToWorld, selectionBounds, unionRects, worldBounds } from "$lib/geometry";
  import { repository } from "$lib/repository";
  import { EditorSession } from "$lib/editor/editor.svelte";
  import EditorCanvas from "$lib/editor/EditorCanvas.svelte";
  import Inspector from "$lib/editor/Inspector.svelte";
  import LeftPanel from "$lib/editor/LeftPanel.svelte";
  import PrototypePreview from "$lib/editor/PrototypePreview.svelte";
  import Toolbar from "$lib/editor/Toolbar.svelte";
  import TerminalPanel from "$lib/editor/TerminalPanel.svelte";

  const repo = repository();
  let session = $state<EditorSession | null>(null);
  let loading = $state(true);
  let error = $state("");
  let context = $state<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  let pageMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let preview = $state(false);
  let panels = $state({ left: true, right: true });
  let terminalOpen = $state(false);
  let terminalHeight = $state(280);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    try {
      const opened = await repo.openFile(route.params.id!);
      session = new EditorSession(opened);
      await loadAssets();
    } catch (cause) { error = cause instanceof Error ? cause.message : "Could not open this design"; }
    finally { loading = false; }
  });

  $effect(() => {
    const token = session?.changeToken ?? 0;
    if (!session || token === 0 || session.saveStatus === "saving" || session.saveStatus === "conflict") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), 420);
    return () => { if (saveTimer) clearTimeout(saveTimer); };
  });

  async function loadAssets() {
    if (!session) return;
    const ids = [...new Set(Object.values(session.document.nodes).filter((node) => node.type === "image").map((node) => (node as Extract<DesignNode, { type: "image" }>).assetId))];
    await Promise.all(ids.map(async (id) => {
      try { session!.imageSources[id] = await repo.readAsset(id); } catch { /* keep an image placeholder */ }
    }));
  }

  function thumbnailSvg(): string | null {
    if (!session || !session.document.rootIds.length) return null;
    const bounds = unionRects(session.document.rootIds.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node)));
    const world = document.querySelector<SVGGElement>("#design-canvas .world")?.cloneNode(true) as SVGGElement | undefined;
    if (!bounds || !world) return null;
    world.querySelectorAll(".selection-ui,.guide").forEach((item) => item.remove());
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}" width="480" height="300"><rect x="${bounds.x}" y="${bounds.y}" width="${Math.max(1, bounds.width)}" height="${Math.max(1, bounds.height)}" fill="#626262"/>${world.innerHTML}</svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
  }

  async function saveNow() {
    if (!session || session.saveStatus === "saving" || session.saveStatus === "saved") return;
    session.saveStatus = "saving";
    try {
      const revision = await repo.savePage(session.page.id, session.page.revision, cloneDocument(session.document), thumbnailSvg());
      session.page.revision = revision;
      const meta = session.pages.find((page) => page.id === session!.page.id);
      if (meta) meta.revision = revision;
      session.saveStatus = "saved";
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("REVISION_CONFLICT")) session.saveStatus = "conflict";
      else { session.saveStatus = "error"; session.errorMessage = cause instanceof Error ? cause.message : "Autosave failed"; }
    }
  }

  async function backToFiles() { await saveNow(); await goto("/"); }

  async function openPage(id: string) {
    if (!session || id === session.page.id) return;
    await saveNow();
    try { const loaded = await repo.loadPage(id); session.setPage(loaded.page, loaded.document); await loadAssets(); }
    catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Could not open the page"; }
  }

  async function createPage() {
    if (!session) return;
    await saveNow();
    try {
      const created = await repo.createPage(session.file.id, `Page ${session.pages.length + 1}`);
      session.pages = [...session.pages, created.page];
      session.setPage(created.page, created.document);
    } catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Could not create a page"; }
  }

  function showPageMenu(event: MouseEvent, id: string) {
    event.preventDefault(); event.stopPropagation();
    pageMenu = { id, x: Math.min(event.clientX, innerWidth - 190), y: Math.min(event.clientY, innerHeight - 190) };
  }

  async function pageAction(action: "rename" | "duplicate" | "delete") {
    if (!session || !pageMenu) return;
    const id = pageMenu.id; pageMenu = null;
    const meta = session.pages.find((page) => page.id === id);
    if (!meta) return;
    try {
      if (action === "rename") {
        const name = prompt("Page name", meta.name)?.trim();
        if (name) { await repo.renamePage(id, name); meta.name = name; session.pages = [...session.pages]; }
      }
      if (action === "duplicate") {
        const created = await repo.duplicatePage(id); session.pages = [...session.pages, created.page]; session.setPage(created.page, created.document);
      }
      if (action === "delete") {
        if (session.pages.length <= 1) throw new Error("A design file needs at least one page");
        await repo.deletePage(id); session.pages = session.pages.filter((page) => page.id !== id);
        if (session.page.id === id) await openPage(session.pages[0].id);
      }
    } catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Page action failed"; }
  }

  function showContext(event: MouseEvent, world: { x: number; y: number }) {
    context = { x: Math.min(event.clientX, innerWidth - 230), y: Math.min(event.clientY, innerHeight - 390), worldX: world.x, worldY: world.y };
  }

  function layerContext(event: MouseEvent, id: string) {
    if (!session) return;
    event.preventDefault(); event.stopPropagation(); session.select(id);
    showContext(event, { x: session.document.nodes[id].x, y: session.document.nodes[id].y });
  }

  async function contextAction(action: string) {
    if (!session || !context) return;
    const point = { x: context.worldX, y: context.worldY }; context = null;
    if (action === "copy") session.copy();
    if (action === "cut") session.cut();
    if (action === "paste") await session.paste(point);
    if (action === "duplicate") session.duplicate();
    if (action === "delete") session.deleteSelection();
    if (action === "front") session.arrange("front");
    if (action === "back") session.arrange("back");
    if (action === "group") session.groupSelection();
    if (action === "frame") session.groupSelection(true);
    if (action === "ungroup") session.ungroupSelection();
    if (action === "visible") session.updateSelected({ visible: !session.selectedNodes.every((node) => node.visible) });
    if (action === "lock") session.updateSelected({ locked: !session.selectedNodes.every((node) => node.locked) });
    if (action === "move-page") await moveToPage();
  }

  async function moveToPage() {
    if (!session || session.pages.length < 2) return;
    const targetName = prompt(`Move to page:\n${session.pages.filter((page) => page.id !== session!.page.id).map((page) => page.name).join("\n")}`)?.trim();
    const target = session.pages.find((page) => page.name.toLowerCase() === targetName?.toLowerCase() && page.id !== session!.page.id);
    if (!target) return;
    session.copy(); session.deleteSelection(); await saveNow(); await openPage(target.id); await session.paste({ x: 40, y: 40 });
  }

  async function renameFile() {
    if (!session) return;
    const name = prompt("File name", session.file.name)?.trim();
    if (!name) return;
    try { await repo.renameFile(session.file.id, name); session.file.name = name; }
    catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Could not rename the file"; }
  }

  function placeIcon(name: string) {
    if (!session) return;
    const center = screenToWorld({ x: (innerWidth - (panels.left ? 297 : 0) - (panels.right ? 241 : 0)) / 2, y: innerHeight / 2 }, session.document.viewport);
    session.addNode(defaultNode("icon", center.x - 32, center.y - 32, { width: 64, height: 64, iconName: name, name }));
    session.leftTab = "file";
  }

  function createPreset(name: string, width: number, height: number) {
    if (!session) return;
    const center = screenToWorld({ x: (innerWidth - 538) / 2, y: innerHeight / 2 }, session.document.viewport);
    session.addNode(defaultNode("frame", center.x - width / 2, center.y - height / 2, { name, width, height }));
  }

  function fitCanvas(target: "auto" | "all" | "selection" = "auto") {
    if (!session) return;
    const useSelection = target === "selection" || (target === "auto" && session.selectedIds.length > 0);
    const bounds = useSelection
      ? selectionBounds(session.document, session.selectedIds)
      : unionRects(session.document.rootIds.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node)));
    if (!bounds) return;
    const canvas = document.querySelector<HTMLElement>("#design-canvas");
    const width = canvas?.clientWidth ?? innerWidth - (panels.left ? 297 : 0) - (panels.right ? 241 : 0);
    const height = canvas?.clientHeight ?? innerHeight;
    const zoom = Math.min(4, Math.max(.05, Math.min((width - 160) / Math.max(1, bounds.width), (height - 160) / Math.max(1, bounds.height))));
    session.document.viewport.zoom = zoom;
    session.document.viewport.x = width / 2 - (bounds.x + bounds.width / 2) * zoom;
    session.document.viewport.y = height / 2 - (bounds.y + bounds.height / 2) * zoom;
    session.gestureChanged();
  }

  function zoomCanvas(factor: number) {
    if (!session) return;
    const canvas = document.querySelector<HTMLElement>("#design-canvas");
    const point = { x: (canvas?.clientWidth ?? innerWidth) / 2, y: (canvas?.clientHeight ?? innerHeight) / 2 };
    const viewport = session.document.viewport;
    const world = screenToWorld(point, viewport);
    const next = Math.min(8, Math.max(.05, viewport.zoom * factor));
    viewport.x = point.x - world.x * next;
    viewport.y = point.y - world.y * next;
    viewport.zoom = next;
    session.gestureChanged();
  }

  async function exportSelection(format: "svg" | "png", scale = 1) {
    if (!session) return;
    const ids = session.selectedIds.length ? session.selectedIds : session.document.rootIds;
    const bounds = unionRects(ids.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node)));
    const world = document.querySelector<SVGGElement>("#design-canvas .world")?.cloneNode(true) as SVGGElement | undefined;
    if (!bounds || !world) { session.errorMessage = "Select a layer or create something before exporting."; return; }
    world.querySelectorAll(".selection-ui,.guide").forEach((item) => item.remove());
    if (session.selectedIds.length) world.querySelectorAll("[data-node-id]").forEach((item) => { if (!ids.includes(item.getAttribute("data-node-id") ?? "") && !item.closest(ids.map((id) => `[data-node-id='${id}']`).join(","))) item.remove(); });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width * scale}" height="${bounds.height * scale}" viewBox="${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}">${world.innerHTML}</svg>`;
    const svgUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    if (format === "svg") await repo.exportRender(session.file.name, "svg", svgUrl);
    else {
      const image = new Image();
      image.onload = async () => {
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.ceil(bounds.width * scale)); canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
        const context2d = canvas.getContext("2d"); context2d?.drawImage(image, 0, 0, canvas.width, canvas.height);
        await repo.exportRender(session!.file.name, "png", canvas.toDataURL("image/png"));
      };
      image.src = svgUrl;
    }
  }

  function keydown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "`") { event.preventDefault(); terminalOpen = !terminalOpen; return; }
    if (!session || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (mod && key === "a") { event.preventDefault(); session.selectAll(); return; }
    if (mod && key === "z") { event.preventDefault(); event.shiftKey ? session.redo() : session.undo(); return; }
    if (mod && key === "y") { event.preventDefault(); session.redo(); return; }
    if (mod && key === "c") { event.preventDefault(); session.copy(); return; }
    if (mod && key === "x") { event.preventDefault(); session.cut(); return; }
    if (mod && key === "v") { event.preventDefault(); void session.paste(); return; }
    if (mod && key === "d") { event.preventDefault(); session.duplicate(); return; }
    if (mod && event.altKey && key === "g") { event.preventDefault(); session.groupSelection(true); return; }
    if (mod && key === "g") { event.preventDefault(); event.shiftKey ? session.ungroupSelection() : session.groupSelection(); return; }
    if (mod && event.shiftKey && key === "h") { event.preventDefault(); session.updateSelected({ visible: !session.selectedNodes.every((node) => node.visible) }); return; }
    if (mod && event.shiftKey && key === "l") { event.preventDefault(); session.updateSelected({ locked: !session.selectedNodes.every((node) => node.locked) }); return; }
    if ((key === "+" || (mod && key === "="))) { event.preventDefault(); zoomCanvas(1.25); return; }
    if (key === "-" && (event.shiftKey || mod)) { event.preventDefault(); zoomCanvas(.8); return; }
    if (event.shiftKey && key === "1") { event.preventDefault(); fitCanvas("all"); return; }
    if (event.shiftKey && key === "2") { event.preventDefault(); fitCanvas("selection"); return; }
    if (key === "]") { event.preventDefault(); session.arrange(mod && !event.altKey && !event.shiftKey ? "forward" : "front"); return; }
    if (key === "[") { event.preventDefault(); session.arrange(mod && !event.altKey && !event.shiftKey ? "backward" : "back"); return; }
    if (mod && (key === "\\" || key === ".")) {
      event.preventDefault();
      const show = !panels.left || !panels.right;
      panels = { left: show, right: show };
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); session.deleteSelection(); return; }
    if (event.key.startsWith("Arrow")) { event.preventDefault(); const amount = event.shiftKey ? 10 : 1; session.nudge(event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0); return; }
    if (key === "escape") { session.activeTool = "select"; session.select(null); context = null; return; }
    if (key === "enter") { event.preventDefault(); event.shiftKey ? session.selectParent() : session.selectFirstChild(); return; }
    const tools: Record<string, typeof session.activeTool> = { v: "select", h: "hand", f: "frame", a: "frame", r: "rectangle", o: "ellipse", l: event.shiftKey ? "arrow" : "line", t: "text" };
    if (tools[key] && !mod) { event.preventDefault(); session.activeTool = tools[key]; }
  }

  function retrySave() {
    if (!session) return;
    session.errorMessage = "";
    session.saveStatus = "dirty";
    void saveNow();
  }

  function dismissSaveError() {
    if (session) session.errorMessage = "";
  }

  function startTerminalResize(event: PointerEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const move = (next: PointerEvent) => {
      terminalHeight = Math.max(150, Math.min(innerHeight - 150, startHeight + startY - next.clientY));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }
</script>

<svelte:head><title>{session?.file.name ?? "Editor"} · Figmaboy</title></svelte:head>
<svelte:window onkeydown={keydown} onclick={() => { context = null; pageMenu = null; }} />

{#if loading}
  <div class="loading"><div class="loader-mark"><span></span><span></span><span></span></div><p>Opening your design…</p></div>
{:else if error || !session}
  <div class="error-screen"><div><X size={24} /></div><h1>Couldn’t open this file</h1><p>{error}</p><button onclick={() => goto("/")}><ChevronLeft size={15} /> Back to projects</button></div>
{:else}
  <div class="editor-shell" class:left-hidden={!panels.left} class:right-hidden={!panels.right}>
    <div class="canvas-region" style:bottom={terminalOpen ? `${terminalHeight}px` : "0"}>
      <EditorCanvas {session} onContextMenu={showContext} />
      <div class="editor-top-left">
        <button title="Back to projects" onclick={backToFiles}><ChevronLeft size={17} /></button>
        <button class="file-title" onclick={renameFile}>{session.file.name}<ChevronDown size={12} /></button>
        <span class:bad={session.saveStatus === "error" || session.saveStatus === "conflict"}>{session.saveStatus === "saving" ? "Saving…" : session.saveStatus === "dirty" ? "Unsaved" : session.saveStatus === "conflict" ? "Save conflict" : session.saveStatus === "error" ? "Save failed" : "Saved locally"}</span>
      </div>
      <button class="panel-toggle left" title="Toggle left panel" onclick={() => (panels.left = !panels.left)}><PanelLeftClose size={15} /></button>
      <button class="panel-toggle right" title="Toggle right panel" onclick={() => (panels.right = !panels.right)}><PanelRightClose size={15} /></button>
      <Toolbar {session} onFit={() => fitCanvas("auto")} {terminalOpen} onToggleTerminal={() => (terminalOpen = !terminalOpen)} />
    </div>
    {#if terminalOpen}
      <div class="terminal-dock" style:height={`${terminalHeight}px`}>
        <button class="terminal-resize" aria-label="Resize terminal" onpointerdown={startTerminalResize}></button>
        <TerminalPanel onClose={() => (terminalOpen = false)} />
      </div>
    {/if}
    {#if panels.left}<LeftPanel {session} onCreatePage={createPage} onOpenPage={openPage} onPageMenu={showPageMenu} onLayerContext={layerContext} onPlaceIcon={placeIcon} />{/if}
    {#if panels.right}<Inspector {session} onCreatePreset={createPreset} onPresent={() => (preview = true)} onExport={exportSelection} />{/if}

    {#if session.errorMessage || session.saveStatus === "conflict"}
      <div class="save-error"><div><strong>{session.saveStatus === "conflict" ? "This page changed elsewhere" : "Could not save"}</strong><span>{session.saveStatus === "conflict" ? "Reload the page or keep working and export a package." : session.errorMessage}</span></div><button onclick={retrySave}><RefreshCw size={14} /> Retry</button><button class="dismiss" onclick={dismissSaveError}><X size={14} /></button></div>
    {/if}
  </div>

  {#if context}
    <div class="editor-context" role="menu" tabindex="-1" style:left={`${context.x}px`} style:top={`${context.y}px`} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && (context = null)}>
      {#if session.selectedIds.length}
        <button onclick={() => contextAction("copy")}><Copy size={13} />Copy<kbd>⌘C</kbd></button><button onclick={() => contextAction("cut")}>Cut<kbd>⌘X</kbd></button><button onclick={() => contextAction("paste")}>Paste here<kbd>⌘V</kbd></button><button onclick={() => contextAction("duplicate")}>Duplicate<kbd>⌘D</kbd></button><hr />
        {#if session.pages.length > 1}<button onclick={() => contextAction("move-page")}>Move to page<span>›</span></button>{/if}<button onclick={() => contextAction("front")}><MoveUp size={13} />Bring to front<kbd>]</kbd></button><button onclick={() => contextAction("back")}><MoveDown size={13} />Send to back<kbd>[</kbd></button><hr />
        {#if session.selectedNodes.some((node) => node.type === "group" || node.type === "frame")}<button onclick={() => contextAction("ungroup")}><Ungroup size={13} />Ungroup<kbd>⇧⌘G</kbd></button>{:else}<button onclick={() => contextAction("group")}><Group size={13} />Group selection<kbd>⌘G</kbd></button><button onclick={() => contextAction("frame")}>Frame selection</button>{/if}<hr />
        <button onclick={() => contextAction("visible")}>{#if session.selectedNodes.every((node) => node.visible)}<EyeOff size={13} />Hide{:else}<Eye size={13} />Show{/if}</button><button onclick={() => contextAction("lock")}>{#if session.selectedNodes.every((node) => node.locked)}<Unlock size={13} />Unlock{:else}<Lock size={13} />Lock{/if}</button><button class="danger" onclick={() => contextAction("delete")}><Trash2 size={13} />Delete<kbd>⌫</kbd></button>
      {:else}<button onclick={() => contextAction("paste")}>Paste here<kbd>⌘V</kbd></button>{/if}
    </div>
  {/if}

  {#if pageMenu}
    <div class="editor-context small" role="menu" tabindex="-1" style:left={`${pageMenu.x}px`} style:top={`${pageMenu.y}px`} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && (pageMenu = null)}><button onclick={() => pageAction("rename")}>Rename</button><button onclick={() => pageAction("duplicate")}>Duplicate</button><hr /><button class="danger" onclick={() => pageAction("delete")}>Delete page</button></div>
  {/if}

  {#if preview}<PrototypePreview {session} onClose={() => (preview = false)} />{/if}
{/if}

<style>
  .editor-shell { position: fixed; inset: 0; background: #626262; overflow: hidden; }.canvas-region { position: absolute; inset: 0 241px 0 297px; transition: bottom 180ms ease; }.left-hidden .canvas-region,.left-hidden .terminal-dock { left: 0; }.right-hidden .canvas-region,.right-hidden .terminal-dock { right: 0; }
  .terminal-dock { position: absolute; z-index: 45; left: 297px; right: 241px; bottom: 0; min-height: 150px; }.terminal-resize { position: absolute; z-index: 2; top: -3px; left: 0; width: 100%; height: 7px; border: 0; padding: 0; background: transparent; cursor: ns-resize; }.terminal-resize:hover { background: #0d99ff; }
  .editor-top-left { position: absolute; z-index: 35; top: 0; left: 0; height: 42px; background: #292929e8; border: 1px solid #444; border-top: 0; border-left: 0; border-radius: 0 0 7px 0; display: flex; align-items: center; padding: 0 7px; gap: 3px; box-shadow: 0 4px 14px #0003; }.editor-top-left button { border: 0; background: transparent; color: #ddd; height: 29px; border-radius: 5px; display: flex; align-items: center; cursor: pointer; }.editor-top-left button:hover { background: #3a3a3a; }.editor-top-left .file-title { max-width: 180px; gap: 5px; font-size: 10px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.editor-top-left > span { color: #6f6f76; font-size: 8px; margin-left: 4px; }.editor-top-left > span.bad { color: #fca5a5; }
  .panel-toggle { position: absolute; z-index: 35; top: 8px; width: 29px; height: 28px; border: 1px solid #4a4a4a; background: #292929; color: #aaa; border-radius: 5px; display: grid; place-items: center; cursor: pointer; }.panel-toggle.left { left: 7px; opacity: 0; pointer-events: none; }.left-hidden .panel-toggle.left { opacity: 1; pointer-events: auto; }.panel-toggle.right { right: 7px; opacity: 0; pointer-events: none; }.right-hidden .panel-toggle.right { opacity: 1; pointer-events: auto; }
  .loading, .error-screen { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1d1d1d; }.loader-mark { display: flex; gap: 4px; animation: pulse 1.2s infinite; }.loader-mark span { width: 12px; height: 30px; border-radius: 8px 3px 3px 8px; background: #f24e1e; }.loader-mark span:nth-child(2) { background: #a259ff; }.loader-mark span:nth-child(3) { background: #1abcfe; }.loading p { color: #777; font-size: 10px; margin-top: 18px; } @keyframes pulse { 50% { transform: scale(.94); opacity: .65; } }
  .error-screen > div { width: 58px; height: 58px; display: grid; place-items: center; border: 1px solid #512727; background: #321d1d; color: #f87171; border-radius: 15px; }.error-screen h1 { font-size: 17px; margin: 17px 0 4px; }.error-screen p { color: #888; font-size: 10px; }.error-screen button { margin-top: 13px; height: 32px; border: 1px solid #414141; border-radius: 6px; background: #2c2c2c; color: white; display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 0 11px; font-size: 10px; }
  .editor-context { position: fixed; z-index: 100; width: 225px; padding: 6px; border: 1px solid #444; border-radius: 7px; background: #202020; box-shadow: 0 15px 45px #0009; }.editor-context.small { width: 165px; }.editor-context button { width: 100%; min-height: 31px; border: 0; border-radius: 4px; background: transparent; color: #eee; padding: 0 8px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 10px; }.editor-context button:hover { background: #373737; }.editor-context kbd,.editor-context button > span { margin-left: auto; color: #888; font: inherit; }.editor-context hr { height: 1px; border: 0; background: #3d3d3d; margin: 5px -6px; }.editor-context .danger { color: #fca5a5; }
  .save-error { position: fixed; z-index: 80; left: 50%; top: 13px; transform: translateX(-50%); min-width: 380px; min-height: 48px; background: #3a2020; border: 1px solid #7f3737; border-radius: 8px; box-shadow: 0 8px 30px #0007; display: flex; align-items: center; gap: 10px; padding: 8px 9px 8px 13px; }.save-error > div { flex: 1; display: flex; flex-direction: column; }.save-error strong { font-size: 10px; }.save-error span { color: #d4a1a1; font-size: 8px; margin-top: 3px; }.save-error button { height: 28px; border: 0; border-radius: 5px; background: #693333; color: #fff; display: flex; align-items: center; gap: 5px; padding: 0 9px; cursor: pointer; font-size: 9px; }.save-error .dismiss { width: 28px; padding: 0; justify-content: center; background: transparent; }
  @media (max-width: 1050px) { .canvas-region,.terminal-dock { left: 56px; }.editor-shell :global(.left-shell) { width: 56px; grid-template-columns: 56px 0; }.editor-shell :global(.left-shell .panel) { display: none; } }
</style>
