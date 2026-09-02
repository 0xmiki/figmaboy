<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import {
    CaretDown as ChevronDown, CaretLeft as ChevronLeft, Copy, Eye, EyeSlash as EyeOff,
    CornersOut as FullscreenIcon,
    Intersect as Group, Lock, ArrowDown as MoveDown, ArrowUp as MoveUp,
    SidebarSimple as PanelLeftClose, SidebarSimple as PanelRightClose,
    ArrowClockwise as RefreshCw, FloppyDisk as Save, Trash as Trash2,
    ExcludeSquare as Ungroup, LockOpen as Unlock, X,
  } from "phosphor-svelte";
  import type { DesignNode, PageDocument, PageMeta } from "$lib/domain";
  import { cloneDocument, defaultNode, uid } from "$lib/domain";
  import { screenToWorld, selectionBounds, unionRects, worldBounds } from "$lib/geometry";
  import { repository } from "$lib/repository";
  import { EditorSession } from "$lib/editor/editor.svelte";
  import { DesignService } from "$lib/editor/design-service";
  import EditorCanvas from "$lib/editor/EditorCanvas.svelte";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";
  import Inspector from "$lib/editor/Inspector.svelte";
  import FrameFullscreenPreview from "$lib/editor/FrameFullscreenPreview.svelte";
  import { stageExtensionManifest } from "$lib/extensions/staging";
  import LeftPanel from "$lib/editor/LeftPanel.svelte";
  import PrototypePreview from "$lib/editor/PrototypePreview.svelte";
  import Toolbar from "$lib/editor/Toolbar.svelte";
  import { applyExternalOperations, centerNodes, nodeGeometry, placeImageNode, setBorderRadius, validateEvolutionOperations, validateEvolutionPassSize } from "$lib/editor/editor-rpc";
  import { EvolveCandidateStore, type EvolveCandidate } from "$lib/editor/evolve-candidates";

  const repo = repository();
  let session = $state<EditorSession | null>(null);
  let loading = $state(true);
  let error = $state("");
  let notice = $state("");
  let context = $state<{ x: number; y: number; worldX: number; worldY: number; targetId?: string } | null>(null);
  let pageMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let preview = $state(false);
  let fullscreenFrameId = $state<string | null>(null);
  let panels = $state({ left: true, right: true });
  let panelWidths = $state({ left: 297, right: 280, codex: 390 });
  let codexOpen = $state(true);
  let codexMounted = $state(false);
  let CodexSidebarComponent = $state<any>(null);
  let codexComponentPromise: Promise<void> | null = null;
  let layoutReady = $state(false);
  let codexAttention = $state<"idle" | "working" | "approval" | "input" | "complete" | "error">("idle");
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  const evolveCandidates = new EvolveCandidateStore();
  let candidateRender = $state<{ document: PageDocument; frameId: string; idPrefix: string } | null>(null);
  let candidateRenderSvg = $state<SVGSVGElement>();
  let candidateRenderQueue: Promise<void> = Promise.resolve();
  const codexVisible = $derived(codexOpen && panels.right && Boolean(CodexSidebarComponent));
  const contextFrame = $derived.by(() => {
    if (!session) return null;
    const target = context?.targetId ? session.document.nodes[context.targetId] : null;
    if (target?.type === "frame") return target;
    return session.selectedNodes.length === 1 && session.selectedNodes[0].type === "frame" ? session.selectedNodes[0] : null;
  });

  type StoredEditorLayout = {
    leftOpen?: boolean;
    rightOpen?: boolean;
    leftWidth?: number;
    rightWidth?: number;
    codexWidth?: number;
    codexOpenByPage?: Record<string, boolean>;
  };

  const layoutStorageKey = `figmaboy:editor-layout:${route.params.id ?? "unknown"}`;

  function clampWidth(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }

  function readEditorLayout(): StoredEditorLayout {
    try {
      const value = JSON.parse(localStorage.getItem(layoutStorageKey) ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function persistEditorLayout(pageId = session?.page.id) {
    if (!layoutReady || !pageId) return;
    const previous = readEditorLayout();
    localStorage.setItem(layoutStorageKey, JSON.stringify({
      leftOpen: panels.left,
      rightOpen: panels.right,
      leftWidth: panelWidths.left,
      rightWidth: panelWidths.right,
      codexWidth: panelWidths.codex,
      codexOpenByPage: { ...(previous.codexOpenByPage ?? {}), [pageId]: codexOpen },
    } satisfies StoredEditorLayout));
  }

  function restorePageCodexState(pageId: string) {
    const stored = readEditorLayout();
    codexOpen = stored.codexOpenByPage?.[pageId] !== false;
    codexMounted = codexOpen;
    if (codexOpen) void ensureCodexComponent();
    if (codexOpen) panels.right = true;
  }

  function restoreEditorLayout(pageId: string) {
    const stored = readEditorLayout();
    panels = { left: stored.leftOpen !== false, right: stored.rightOpen !== false };
    panelWidths = {
      left: clampWidth(stored.leftWidth, 297, 220, 520),
      right: clampWidth(stored.rightWidth, 280, 280, 520),
      codex: clampWidth(stored.codexWidth, 390, 320, 640),
    };
    restorePageCodexState(pageId);
    layoutReady = true;
  }

  onMount(async () => {
    try {
      const opened = await repo.openFile(route.params.id!);
      session = new EditorSession(opened);
      restoreEditorLayout(session.page.id);
      void loadAssets(session.page.id);
    } catch (cause) { error = cause instanceof Error ? cause.message : "Could not open this design"; }
    finally { loading = false; }
  });

  onMount(() => {
    const load = () => void ensureCodexComponent().catch(() => undefined);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  });

  type EditorRpcRequest = { id: string; method: string; params: unknown };

  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let remove: (() => void) | undefined;
    void listen<EditorRpcRequest>("editor-rpc-request", ({ payload }) => {
      void handleEditorRpc(payload)
        .then((result) => invoke("editor_bridge_complete", { id: payload.id, result, error: null }))
        .catch((cause) => invoke("editor_bridge_complete", { id: payload.id, result: null, error: cause instanceof Error ? cause.message : String(cause) }));
    }).then((unlisten) => (remove = unlisten));
    return () => remove?.();
  });

  onMount(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveNow();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  });

  $effect(() => {
    const token = session?.persistenceToken ?? 0;
    if (!session || token === 0 || session.saveStatus === "saving" || session.saveStatus === "conflict") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), 420);
    return () => { if (saveTimer) clearTimeout(saveTimer); };
  });

  $effect(() => {
    panels.left; panels.right; codexOpen; session?.page.id;
    if (layoutReady) persistEditorLayout();
  });

  async function loadAssets(pageId = session?.page.id) {
    if (!session || !pageId || session.page.id !== pageId) return;
    const ids = [...new Set(Object.values(session.document.nodes).filter((node) => node.type === "image").map((node) => (node as Extract<DesignNode, { type: "image" }>).assetId))];
    await Promise.all(ids.map(async (id) => {
      try {
        const source = await repo.readAsset(id);
        if (session?.page.id === pageId) session.imageSources[id] = source;
      } catch { /* keep an image placeholder */ }
    }));
  }

  async function cloneFullCanvasWorld(): Promise<SVGGElement | undefined> {
    if (!session) return undefined;
    const previous = session.renderAllNodes;
    session.renderAllNodes = true;
    await tick();
    const world = document.querySelector<SVGGElement>("#design-canvas .world")?.cloneNode(true) as SVGGElement | undefined;
    session.renderAllNodes = previous;
    return world;
  }

  async function rasterizeThumbnail(markup: string): Promise<string | null> {
    const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not render the design preview"));
        image.src = source;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 300;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#626262";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.78);
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  type EvolveRenderResult = { imageBase64: string; mimeType: string; width: number; height: number; thumbnailBase64: string; thumbnailMimeType: string };

  async function renderEvolveCandidate(candidate: EvolveCandidate): Promise<EvolveRenderResult> {
    const frame = candidate.document.nodes[candidate.frameId];
    if (frame?.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: the evolution target is no longer available");
    candidateRender = { document: candidate.document, frameId: candidate.frameId, idPrefix: `candidate-${candidate.runId}-${candidate.candidateId}` };
    let svg: SVGSVGElement | undefined;
    try {
      await tick();
      await document.fonts?.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      svg = candidateRenderSvg?.cloneNode(true) as SVGSVGElement | undefined;
    } finally {
      candidateRender = null;
      candidateRenderSvg = undefined;
    }
    if (!svg) throw new Error("Could not mount the candidate renderer");
    const scale = Math.min(1, 1600 / Math.max(1, frame.width, frame.height));
    const width = Math.max(1, Math.ceil(frame.width * scale));
    const height = Math.max(1, Math.ceil(frame.height * scale));
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const source = URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not rasterize the evolution candidate"));
        image.src = source;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context2d = canvas.getContext("2d");
      if (!context2d) throw new Error("Could not create the candidate image canvas");
      context2d.drawImage(image, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", .86);
      const thumbnailScale = Math.min(1, 240 / Math.max(width, height));
      const thumbnail = document.createElement("canvas");
      thumbnail.width = Math.max(1, Math.round(width * thumbnailScale));
      thumbnail.height = Math.max(1, Math.round(height * thumbnailScale));
      const thumbnailContext = thumbnail.getContext("2d");
      if (!thumbnailContext) throw new Error("Could not create the candidate thumbnail canvas");
      thumbnailContext.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      const thumbnailDataUrl = thumbnail.toDataURL("image/jpeg", .72);
      return {
        imageBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg", width, height,
        thumbnailBase64: thumbnailDataUrl.slice(thumbnailDataUrl.indexOf(",") + 1), thumbnailMimeType: "image/jpeg",
      };
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  function queueEvolveCandidateRender(candidate: EvolveCandidate): Promise<EvolveRenderResult> {
    const result = candidateRenderQueue.then(() => renderEvolveCandidate(candidate));
    candidateRenderQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function waitForCommittedGesture(expectedPageEpoch: number): Promise<void> {
    while (session?.hasActiveGesture) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!session || session.pageEpoch !== expectedPageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the evolution page is no longer active");
    }
  }

  async function thumbnailSvg(): Promise<string | null> {
    if (!session || !session.document.rootIds.length) return null;
    const bounds = unionRects(session.document.rootIds.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node)));
    const world = await cloneFullCanvasWorld();
    if (!bounds || !world) return null;
    world.querySelectorAll(".selection-ui,.guide").forEach((item) => item.remove());
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}" width="480" height="300"><rect x="${bounds.x}" y="${bounds.y}" width="${Math.max(1, bounds.width)}" height="${Math.max(1, bounds.height)}" fill="#626262"/>${world.innerHTML}</svg>`;
    return rasterizeThumbnail(markup);
  }

  function scheduleThumbnailRefresh(pageId: string, changeToken: number) {
    if (thumbnailTimer) clearTimeout(thumbnailTimer);
    thumbnailTimer = setTimeout(() => {
      thumbnailTimer = null;
      void refreshThumbnail(pageId, changeToken);
    }, 1_200);
  }

  async function refreshThumbnail(pageId: string, changeToken: number) {
    if (!session || session.page.id !== pageId) return;
    if (session.persistencePaused) {
      scheduleThumbnailRefresh(pageId, changeToken);
      return;
    }
    try {
      const thumbnail = await thumbnailSvg();
      if (!thumbnail || !session || session.page.id !== pageId) return;
      await repo.savePagePreview(pageId, thumbnail);
      if (session.thumbnailChangeToken === changeToken) session.thumbnailDirty = false;
    } catch {
      // The document is already saved. Keep the preview dirty and try again after the next edit.
    }
  }

  async function saveNow() {
    if (!session || session.saveStatus === "saving" || session.saveStatus === "saved") return;
    if (session.persistencePaused) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void saveNow(), 250);
      return;
    }
    session.saveStatus = "saving";
    const savingToken = session.persistenceToken;
    const pageId = session.page.id;
    const expectedRevision = session.page.revision;
    const snapshot = cloneDocument(session.document);
    const savingThumbnailToken = session.thumbnailChangeToken;
    const refreshThumbnail = session.thumbnailDirty;
    try {
      const revision = await repo.savePage(pageId, expectedRevision, snapshot);
      if (session.page.id === pageId) session.page.revision = revision;
      const meta = session.pages.find((page) => page.id === pageId);
      if (meta) meta.revision = revision;
      if (refreshThumbnail) scheduleThumbnailRefresh(pageId, savingThumbnailToken);
      session.saveStatus = session.persistenceToken === savingToken ? "saved" : "dirty";
      if (session.saveStatus === "dirty") {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void saveNow(), 120);
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("REVISION_CONFLICT")) session.saveStatus = "conflict";
      else { session.saveStatus = "error"; session.errorMessage = cause instanceof Error ? cause.message : "Autosave failed"; }
    }
  }

  onDestroy(() => {
    session?.cancelExternalPreview();
    evolveCandidates.clear();
    candidateRender = null;
    if (saveTimer) clearTimeout(saveTimer);
    if (thumbnailTimer) clearTimeout(thumbnailTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
    if (nudgeTimer) clearTimeout(nudgeTimer);
  });

  async function backToFiles() { await saveNow(); await goto("/"); }

  async function openPage(id: string) {
    if (!session || id === session.page.id) return;
    persistEditorLayout(session.page.id);
    await saveNow();
    try { const loaded = await repo.loadPage(id); session.setPage(loaded.page, loaded.document); restorePageCodexState(id); void loadAssets(id); }
    catch (cause) { session.errorMessage = cause instanceof Error ? cause.message : "Could not open the page"; }
  }

  async function createPage() {
    if (!session) return;
    await saveNow();
    try {
      const created = await repo.createPage(session.file.id, `Page ${session.pages.length + 1}`);
      session.pages = [...session.pages, created.page];
      session.setPage(created.page, created.document);
      restorePageCodexState(created.page.id);
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

  function showContext(event: MouseEvent, world: { x: number; y: number }, targetId?: string) {
    context = { x: Math.min(event.clientX, innerWidth - 230), y: Math.min(event.clientY, innerHeight - 390), worldX: world.x, worldY: world.y, ...(targetId ? { targetId } : {}) };
  }

  function layerContext(event: MouseEvent, id: string) {
    if (!session) return;
    event.preventDefault(); event.stopPropagation();
    if (!session.selectedIds.includes(id)) session.select(id, false, true);
    showContext(event, { x: session.document.nodes[id].x, y: session.document.nodes[id].y }, id);
  }

  async function contextAction(action: string) {
    if (!session || !context) return;
    const point = { x: context.worldX, y: context.worldY };
    const targetFrameId = contextFrame?.id ?? null;
    context = null;
    if (action === "copy") session.copy();
    if (action === "copy-image" && targetFrameId) await copyFrameAsImage(targetFrameId);
    if (action === "fullscreen") {
      if (targetFrameId) fullscreenFrameId = targetFrameId;
    }
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
    const rightWidth = panelWidths.codex;
    const width = canvas?.clientWidth ?? innerWidth - (panels.left ? panelWidths.left : 0) - (panels.right ? rightWidth : 0);
    const height = canvas?.clientHeight ?? innerHeight;
    const zoom = Math.min(4, Math.max(.05, Math.min((width - 160) / Math.max(1, bounds.width), (height - 160) / Math.max(1, bounds.height))));
    session.document.viewport.zoom = zoom;
    session.document.viewport.x = width / 2 - (bounds.x + bounds.width / 2) * zoom;
    session.document.viewport.y = height / 2 - (bounds.y + bounds.height / 2) * zoom;
    session.viewportChanged();
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
    session.viewportChanged();
  }

  function resetZoom() {
    if (!session) return;
    const viewport = session.document.viewport;
    const canvas = document.querySelector<HTMLElement>("#design-canvas");
    const point = { x: (canvas?.clientWidth ?? innerWidth) / 2, y: (canvas?.clientHeight ?? innerHeight) / 2 };
    const world = screenToWorld(point, viewport);
    viewport.zoom = 1;
    viewport.x = point.x - world.x;
    viewport.y = point.y - world.y;
    session.viewportChanged();
  }

  async function exportSelection(format: "svg" | "png", scale = 1) {
    if (!session) return;
    const ids = session.selectedIds.length ? session.selectedIds : session.document.rootIds;
    const bounds = unionRects(ids.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node)));
    const world = await cloneFullCanvasWorld();
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

  function showNotice(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 2600);
  }

  async function copyDesignId() {
    if (!session) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(session.file.id);
      showNotice(`Copied design ID: ${session.file.id}`);
    } catch (cause) {
      session.errorMessage = cause instanceof Error ? cause.message : "Could not copy the design ID";
    }
  }

  async function rasterizeNodes(ids: string[], requestedScale: number, maxDimension = 4096) {
    if (!session || !ids.length) throw new Error("Nothing to render");
    const nodes = ids.map((id) => session!.document.nodes[id]).filter(Boolean);
    const bounds = unionRects(nodes.map((node) => worldBounds(session!.document, node)));
    const world = await cloneFullCanvasWorld();
    if (!bounds || !world) throw new Error("Could not render the design canvas");
    world.removeAttribute("transform");
    world.style.removeProperty("transform");
    world.style.removeProperty("will-change");
    world.querySelectorAll(".selection-ui,.guide").forEach((item) => item.remove());
    const selector = ids.map((candidate) => `[data-node-id='${candidate}']`).join(",");
    world.querySelectorAll("[data-node-id]").forEach((item) => {
      const id = item.getAttribute("data-node-id");
      if (id && !ids.includes(id) && !item.closest(selector)) item.remove();
    });
    const desiredScale = Math.max(.25, Math.min(4, Number(requestedScale) || 1));
    const dimensionLimit = Math.max(640, Math.min(4096, Number(maxDimension) || 4096));
    const scale = Math.min(desiredScale, dimensionLimit / Math.max(1, bounds.width), dimensionLimit / Math.max(1, bounds.height));
    const width = Math.max(1, Math.ceil(bounds.width * scale));
    const height = Math.max(1, Math.ceil(bounds.height * scale));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}">${world.outerHTML}</svg>`;
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not rasterize design")); });
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    await loaded;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context2d = canvas.getContext("2d");
    if (!context2d) throw new Error("Could not create the image canvas");
    context2d.drawImage(image, 0, 0, width, height);
    return { canvas, width, height, bounds, ids, scale };
  }

  async function copyFrameAsImage(frameId: string) {
    if (!session || session.document.nodes[frameId]?.type !== "frame") return;
    try {
      const frame = session.document.nodes[frameId];
      const scale = Math.min(4, Math.max(2, 3840 / Math.max(1, frame.width, frame.height)));
      const rendered = await rasterizeNodes([frameId], scale);
      if ("__TAURI_INTERNALS__" in window) {
        const png = rendered.canvas.toDataURL("image/png");
        await invoke<string>("copy_image_to_clipboard", {
          dataBase64: png.slice(png.indexOf(",") + 1), filename: `${frame.name}.png`,
        });
      } else {
        const blob = await new Promise<Blob>((resolve, reject) => rendered.canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode frame image")), "image/png"));
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard access is unavailable");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
      showNotice(`Copied ${frame.name} as ${rendered.width} × ${rendered.height} image`);
    } catch (cause) {
      session.errorMessage = cause instanceof Error ? cause.message : "Could not copy frame as an image";
    }
  }

  async function renderForRpc(paramsValue: unknown) {
    if (!session) throw new Error("NO_ACTIVE_EDITOR");
    const params = (paramsValue && typeof paramsValue === "object" ? paramsValue : {}) as { scope?: string; ids?: string[]; scale?: number; maxDimension?: number; format?: string; quality?: number };
    const ids = params.scope === "selection"
      ? (params.ids?.length ? params.ids : session.selectedIds)
      : (params.ids?.length ? params.ids : session.document.rootIds);
    const rendered = await rasterizeNodes(ids, Number(params.scale) || 1, Number(params.maxDimension) || 4096);
    const jpeg = params.format === "jpeg";
    const mimeType = jpeg ? "image/jpeg" : "image/png";
    const quality = Math.max(.65, Math.min(.95, Number(params.quality) || .86));
    const dataUrl = rendered.canvas.toDataURL(mimeType, jpeg ? quality : undefined);
    return { mimeType, imageBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), width: rendered.width, height: rendered.height, bounds: rendered.bounds, ids, scale: rendered.scale };
  }

  function evolvePreviewOwner(): boolean {
    return session?.externalPreviewSource?.kind === "codex" && session.externalPreviewSource.id.startsWith("evolve:");
  }

  function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
    return JSON.stringify(value);
  }

  async function handleEditorRpc(request: EditorRpcRequest): Promise<unknown> {
    if (!session) throw new Error("NO_ACTIVE_EDITOR: open a design file");
    const params = (request.params && typeof request.params === "object" ? request.params : {}) as Record<string, unknown>;
    const canvas = document.querySelector<HTMLElement>("#design-canvas");
    const rect = canvas?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
    if (request.method === "editor_status") return {
      file: session.file, page: session.page, pages: session.pages, changeToken: session.changeToken, pageEpoch: session.pageEpoch,
      selectedIds: session.selectedIds, activeTool: session.activeTool, saveStatus: session.saveStatus,
      viewport: session.document.viewport,
      canvas: { clientRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, screenOrigin: { x: window.screenX + rect.x, y: window.screenY + rect.y }, devicePixelRatio: window.devicePixelRatio },
    };
    if (request.method === "document_get") return { changeToken: session.changeToken, pageEpoch: session.pageEpoch, document: cloneDocument(session.document) };
    if (request.method === "nodes_get") {
      const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string") : Object.keys(session.document.nodes);
      const type = typeof params.type === "string" ? params.type : null;
      const name = typeof params.name === "string" ? params.name.toLowerCase() : null;
      const nodes = ids.map((id) => session!.document.nodes[id]).filter((node) => node && (!type || node.type === type) && (!name || node.name.toLowerCase().includes(name)));
      return { changeToken: session.changeToken, nodes };
    }
    if (request.method === "geometry_get") {
      const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string") : session.selectedIds;
      const canvasClientRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      return { changeToken: session.changeToken, viewport: session.document.viewport, canvasClientRect, nodes: nodeGeometry(session, ids, canvasClientRect) };
    }
    if (request.method === "evolve_reconstruction_start") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      const sourceFrameId = typeof params.sourceFrameId === "string" ? params.sourceFrameId : "";
      if (!runId) throw new Error("EVOLVE_RUN_MISSING: runId is required");
      if (typeof params.expectedChangeToken === "number" && params.expectedChangeToken !== session.changeToken) throw new Error(`STALE_DOCUMENT: expected changeToken ${params.expectedChangeToken}, current value is ${session.changeToken}`);
      if (typeof params.pageEpoch === "number" && params.pageEpoch !== session.pageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the active page changed before reconstruction started");
      const source = session.document.nodes[sourceFrameId];
      if (source?.type !== "frame") throw new Error("EVOLVE_NEEDS_FRAME: select a frame to use as the reconstruction reference");
      await waitForCommittedGesture(session.pageEpoch);
      const sourceBounds = worldBounds(session.document, source);
      const gap = Math.max(160, Math.min(320, source.width * .12));
      const occupied = session.document.rootIds.map((id) => session!.document.nodes[id]).filter(Boolean).map((node) => worldBounds(session!.document, node));
      let draftX = sourceBounds.x + sourceBounds.width + gap;
      const draftY = sourceBounds.y;
      for (let attempt = 0; attempt < occupied.length + 1; attempt += 1) {
        const collision = occupied.find((bounds) => draftX < bounds.x + bounds.width + gap && draftX + source.width + gap > bounds.x && draftY < bounds.y + bounds.height + gap && draftY + source.height + gap > bounds.y);
        if (!collision) break;
        draftX = collision.x + collision.width + gap;
      }
      const draftFrameId = uid("evolve");
      const draft = defaultNode("frame", draftX, draftY, { id: draftFrameId, name: `${source.name} · Evolution`, width: source.width, height: source.height, clipContent: source.clipContent });
      const result = new DesignService(session).transact({
        label: "Start evolution reconstruction",
        source: { kind: "codex", id: `evolve:${runId}` },
        expectedChangeToken: session.changeToken,
        operations: [{ kind: "create", node: draft }] as unknown as Parameters<DesignService["transact"]>[0]["operations"],
      });
      session.setSelection([sourceFrameId, draftFrameId]);
      fitCanvas("selection");
      session.setSelection([draftFrameId]);
      const run = evolveCandidates.start({ runId, fileId: session.file.id, pageId: session.page.id, pageEpoch: session.pageEpoch, frameId: draftFrameId, contentRevision: session.changeToken, document: session.document });
      return { ...result, runId, sourceFrameId, draftFrameId, frameId: draftFrameId, pageId: run.pageId, pageEpoch: run.pageEpoch, changeToken: run.baseContentRevision, document: cloneDocument(session.document) };
    }
    if (request.method === "evolve_run_start") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      const frameId = typeof params.frameId === "string" ? params.frameId : "";
      if (!runId) throw new Error("EVOLVE_RUN_MISSING: runId is required");
      if (typeof params.expectedChangeToken === "number" && params.expectedChangeToken !== session.changeToken) throw new Error(`STALE_DOCUMENT: expected changeToken ${params.expectedChangeToken}, current value is ${session.changeToken}`);
      if (typeof params.pageEpoch === "number" && params.pageEpoch !== session.pageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the active page changed before evolution started");
      const run = evolveCandidates.start({ runId, fileId: session.file.id, pageId: session.page.id, pageEpoch: session.pageEpoch, frameId, contentRevision: session.changeToken, document: session.document });
      return { runId, frameId, pageId: run.pageId, pageEpoch: run.pageEpoch, changeToken: run.baseContentRevision };
    }
    if (request.method === "evolve_candidate_render") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
      const run = evolveCandidates.run(runId);
      if (run.fileId !== session.file.id || run.pageId !== session.page.id || run.pageEpoch !== session.pageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the evolution page is no longer active");
      if (!candidateId) throw new Error("EVOLVE_CANDIDATE_MISSING: candidateId is required");
      const operations = Array.isArray(params.operations) ? params.operations : [];
      const validationToken = typeof params.validationToken === "string" ? params.validationToken : "";
      if (!validationToken) throw new Error("EVOLVE_VALIDATION_REQUIRED: validate the candidate before rendering it");
      const candidate = evolveCandidates.candidate(runId, candidateId);
      if (candidate.validationToken !== validationToken || canonicalJson(candidate.operations) !== canonicalJson(operations)) throw new Error("EVOLVE_VALIDATION_REQUIRED: candidate operations changed after validation");
      return { ...(await queueEvolveCandidateRender(candidate)), runId, candidateId, frameId: run.frameId, baseChangeToken: run.baseContentRevision, renderedChangeToken: candidate.renderedContentRevision, document: candidate.document };
    }
    if (request.method === "evolve_candidate_validate") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
      const run = evolveCandidates.run(runId);
      if (run.fileId !== session.file.id || run.pageId !== session.page.id || run.pageEpoch !== session.pageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the evolution page is no longer active");
      if (!candidateId) throw new Error("EVOLVE_CANDIDATE_MISSING: candidateId is required");
      const operations = Array.isArray(params.operations) ? params.operations : [];
      validateEvolutionPassSize(operations);
      const candidate = evolveCandidates.materialize(runId, candidateId, operations);
      return { valid: true, runId, candidateId, frameId: run.frameId, validationToken: candidate.validationToken, createdIds: candidate.createdIds, operationCount: candidate.operations.length };
    }
    if (request.method === "evolve_candidate_commit") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
      const run = evolveCandidates.run(runId);
      if (run.fileId !== session.file.id || run.pageId !== session.page.id || run.pageEpoch !== session.pageEpoch) throw new Error("EVOLVE_PAGE_CHANGED: the evolution page is no longer active");
      await waitForCommittedGesture(run.pageEpoch);
      let candidate = evolveCandidates.candidate(runId, candidateId);
      if (candidate.renderedContentRevision !== session.changeToken) {
        const rebased = evolveCandidates.rebase(runId, candidateId, session.document, session.changeToken);
        if (rebased.conflicts.length) throw new Error(`EVOLVE_REBASE_CONFLICT: ${rebased.conflicts.join(" | ")}`);
        candidate = rebased.candidate;
        return { ...(await queueEvolveCandidateRender(candidate)), committed: false, needsReview: true, runId, candidateId, frameId: run.frameId, renderedChangeToken: candidate.renderedContentRevision, document: candidate.document };
      }
      validateEvolutionOperations(session, run.frameId, candidate.operations);
      const result = new DesignService(session).transact({
        label: "Evolve frame",
        source: { kind: "codex", id: `evolve:${runId}` },
        expectedChangeToken: session.changeToken,
        operations: candidate.operations as Parameters<DesignService["transact"]>[0]["operations"],
      });
      return { ...result, committed: true, needsReview: false, runId, candidateId, frameId: run.frameId };
    }
    if (request.method === "evolve_run_discard") {
      const runId = typeof params.runId === "string" ? params.runId : "";
      evolveCandidates.discard(runId);
      return { runId, discarded: true };
    }
    if (request.method === "operations_preview") {
      const frameId = typeof params.frameId === "string" ? params.frameId : "";
      const runId = typeof params.runId === "string" && params.runId ? params.runId : "unknown";
      if (session.hasExternalPreview && !evolvePreviewOwner()) throw new Error("ANOTHER_PREVIEW_ACTIVE: finish the current canvas preview first");
      const operations = Array.isArray(params.operations) ? params.operations : [];
      validateEvolutionOperations(session, frameId, operations);
      const service = new DesignService(session);
      const result = service.preview({
        label: typeof params.label === "string" && params.label.trim() ? params.label.trim() : "Evolve frame",
        source: { kind: "codex", id: `evolve:${runId}` },
        expectedChangeToken: typeof params.expectedChangeToken === "number" ? params.expectedChangeToken : undefined,
        operations,
      });
      return { ...result, previewActive: true, frameId };
    }
    if (request.method === "operations_preview_commit") {
      if (!evolvePreviewOwner()) throw new Error("NO_EVOLVE_PREVIEW: there is no evolution candidate to commit");
      new DesignService(session).commitPreview();
      return { changeToken: session.changeToken, previewActive: false };
    }
    if (request.method === "operations_preview_discard") {
      if (!evolvePreviewOwner()) throw new Error("NO_EVOLVE_PREVIEW: there is no evolution candidate to discard");
      new DesignService(session).discardPreview();
      return { changeToken: session.changeToken, previewActive: false };
    }
    if (request.method === "operations_apply") return applyExternalOperations(session, params);
    if (request.method === "nodes_center") return centerNodes(session, params);
    if (request.method === "nodes_set_border_radius") return setBorderRadius(session, params);
    if (request.method === "image_place") {
      if (typeof params.expectedChangeToken === "number" && params.expectedChangeToken !== session.changeToken) throw new Error(`STALE_DOCUMENT: expected changeToken ${params.expectedChangeToken}, current value is ${session.changeToken}`);
      if (typeof params.imageBase64 !== "string" || !params.imageBase64.length) throw new Error("imageBase64 is required");
      const asset = await repo.importImageData(params.imageBase64);
      session.imageSources[asset.id] = asset.dataUrl;
      return placeImageNode(session, asset, params);
    }
    if (request.method === "selection_set") {
      const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string" && Boolean(session!.document.nodes[id])) : [];
      session.selectedIds = ids; return { selectedIds: ids };
    }
    if (request.method === "viewport_focus") {
      const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string" && Boolean(session!.document.nodes[id])) : [];
      if (ids.length) session.selectedIds = ids;
      fitCanvas(ids.length ? "selection" : "all");
      return { viewport: session.document.viewport, selectedIds: session.selectedIds };
    }
    if (request.method === "history_undo") { session.undo(); return { changeToken: session.changeToken }; }
    if (request.method === "history_redo") { session.redo(); return { changeToken: session.changeToken }; }
    if (request.method === "document_save") { await saveNow(); return { revision: session.page.revision, saveStatus: session.saveStatus, changeToken: session.changeToken }; }
    if (request.method === "frame_screenshot") {
      const frameId = typeof params.frameId === "string" ? params.frameId : "";
      const frame = session.document.nodes[frameId];
      if (frame?.type !== "frame") throw new Error(`frameId must identify a frame; received ${frameId || "nothing"}`);
      return renderForRpc({ scope: "selection", ids: [frameId], scale: params.scale });
    }
    if (request.method === "render") return renderForRpc(params);
    if (request.method === "extension_stage") {
      const result = await stageExtensionManifest(repo, params.manifest);
      session.leftTab = "extensions";
      panels.left = true;
      return result;
    }
    throw new Error(`Unknown editor RPC method: ${request.method}`);
  }

  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const target = event.target instanceof Element ? event.target : null;
    const typing = target?.matches("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']") || target?.closest("[contenteditable]:not([contenteditable='false']), [role='textbox']");
    if (!session) return;
    if (event.ctrlKey && key === "`") { event.preventDefault(); toggleCodex(); return; }
    if (typing) return;
    if (session.externalPreviewActive) { event.preventDefault(); return; }
    if (!event.key.startsWith("Arrow")) commitNudge();
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
    if ((key === "+" || (mod && key === "="))) { event.preventDefault(); if (session.persistencePaused) session.requestInteractionCancel(); else zoomCanvas(1.25); return; }
    if (key === "-" && (event.shiftKey || mod)) { event.preventDefault(); if (session.persistencePaused) session.requestInteractionCancel(); else zoomCanvas(.8); return; }
    if (event.shiftKey && key === "1") { event.preventDefault(); if (session.persistencePaused) session.requestInteractionCancel(); else fitCanvas("all"); return; }
    if (event.shiftKey && key === "2") { event.preventDefault(); if (session.persistencePaused) session.requestInteractionCancel(); else fitCanvas("selection"); return; }
    if (event.shiftKey && key === "0") { event.preventDefault(); if (session.persistencePaused) session.requestInteractionCancel(); else resetZoom(); return; }
    if (key === "]") { event.preventDefault(); session.arrange(mod && !event.altKey && !event.shiftKey ? "forward" : "front"); return; }
    if (key === "[") { event.preventDefault(); session.arrange(mod && !event.altKey && !event.shiftKey ? "backward" : "back"); return; }
    if (mod && (key === "\\" || key === ".")) {
      event.preventDefault();
      const show = !panels.left || !panels.right;
      setPanelsVisible(show);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); session.deleteSelection(); return; }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const amount = event.shiftKey ? 10 : 1;
      session.beginGesture();
      session.nudge(event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0, false);
      if (nudgeTimer) clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(commitNudge, 300);
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      context = null;
      if (session.persistencePaused || session.hasActiveGesture) {
        session.requestInteractionCancel();
        return;
      }
      session.setActiveTool("select");
      session.select(null);
      return;
    }
    if (key === "enter") { event.preventDefault(); event.shiftKey ? session.selectParent() : session.selectFirstChild(); return; }
    const tools: Record<string, typeof session.activeTool> = { v: "select", h: "hand", f: "frame", a: "frame", r: "rectangle", o: "ellipse", l: event.shiftKey ? "arrow" : "line", t: "text" };
    if (tools[key] && !mod) { event.preventDefault(); session.setActiveTool(tools[key]); }
  }

  function commitNudge() {
    if (!nudgeTimer) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    session?.commitGesture();
  }

  function keyup(event: KeyboardEvent) {
    if (event.key.startsWith("Arrow")) commitNudge();
  }

  function retrySave() {
    if (!session) return;
    session.errorMessage = "";
    session.saveStatus = "dirty";
    void saveNow();
  }

  async function resolveConflict(strategy: "reload" | "keep-local") {
    if (!session) return;
    if (strategy === "reload" && !confirm("Discard local changes and reload the version saved elsewhere?")) return;
    try {
      const latest = await repo.loadPage(session.page.id);
      if (strategy === "reload") {
        session.setPage(latest.page, latest.document);
        void loadAssets(session.page.id);
        return;
      }
      session.page.revision = latest.page.revision;
      const meta = session.pages.find((page) => page.id === latest.page.id);
      if (meta) meta.revision = latest.page.revision;
      session.saveStatus = "dirty";
      await saveNow();
    } catch (cause) {
      session.saveStatus = "error";
      session.errorMessage = cause instanceof Error ? cause.message : "Could not resolve the save conflict";
    }
  }

  function dismissSaveError() {
    if (session) session.errorMessage = "";
  }

  function setCodexOpen(open: boolean) {
    if (open && session?.hasExternalPreview) session.cancelExternalPreview();
    codexMounted ||= open;
    codexOpen = open;
    if (open) void ensureCodexComponent();
    if (open) panels.right = true;
  }

  function showInspectorTab(tab: "design" | "prototype") {
    if (!session) return;
    session.inspectorTab = tab;
    setCodexOpen(false);
  }

  function ensureCodexComponent(): Promise<void> {
    if (CodexSidebarComponent) return Promise.resolve();
    codexComponentPromise ??= import("$lib/editor/CodexSidebar.svelte").then((module) => {
      CodexSidebarComponent = module.default;
    }).catch((cause) => { codexComponentPromise = null; throw cause; });
    return codexComponentPromise;
  }

  function toggleCodex() {
    if (!panels.right) { panels.right = true; setCodexOpen(true); return; }
    setCodexOpen(!codexOpen);
  }

  function togglePanel(side: "left" | "right") {
    if (side === "left") panels.left = !panels.left;
    else panels.right = !panels.right;
  }

  function setPanelsVisible(visible: boolean) {
    panels = { left: visible, right: visible };
  }

  function startPanelResize(event: PointerEvent, side: "left" | "right") {
    event.preventDefault();
    const startX = event.clientX;
    const rightKey = "codex" as const;
    const startWidth = side === "left" ? panelWidths.left : panelWidths[rightKey];
    const shell = (event.currentTarget as HTMLElement).closest<HTMLElement>(".editor-shell");
    const property = side === "left" ? "--left-panel-width" : rightKey === "codex" ? "--codex-panel-width" : "--right-panel-width";
    let nextWidth = startWidth;
    let pendingX = startX;
    let resizeFrame = 0;
    document.body.classList.add("resizing-panels");

    const applyWidth = () => {
      resizeFrame = 0;
      const delta = side === "left" ? pendingX - startX : startX - pendingX;
      const min = side === "left" ? 220 : 320;
      const max = side === "left" ? Math.min(520, innerWidth - 360) : Math.min(640, innerWidth - 280);
      nextWidth = Math.max(min, Math.min(max, startWidth + delta));
      shell?.style.setProperty(property, `${nextWidth}px`);
    };
    const move = (pointer: PointerEvent) => {
      pendingX = pointer.clientX;
      if (!resizeFrame) resizeFrame = requestAnimationFrame(applyWidth);
    };
    const stop = (pointer: PointerEvent) => {
      pendingX = pointer.clientX;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      applyWidth();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing-panels");
      panelWidths = { ...panelWidths, [side === "left" ? "left" : rightKey]: nextWidth };
      persistEditorLayout();
      window.dispatchEvent(new CustomEvent("figmaboy-panel-resize-end"));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }
</script>

<svelte:head><title>{session?.file.name ?? "Editor"} · Figmaboy</title></svelte:head>
<svelte:window onkeydown={keydown} onkeyup={keyup} onclick={() => { context = null; pageMenu = null; }} />

{#if loading}
  <div class="loading" aria-hidden="true"></div>
{:else if error || !session}
  <div class="error-screen"><img class="screen-brand" src="/figmaboy.svg" alt="" /><div class="error-icon"><X size={24} /></div><h1>Couldn’t open this file</h1><p>{error}</p><button onclick={() => goto("/")}><ChevronLeft size={15} /> Back to projects</button></div>
{:else}
  <div class="editor-shell" class:left-hidden={!panels.left} class:right-hidden={!panels.right} class:codex-open={panels.right} style={`--left-panel-width:${panelWidths.left}px;--right-panel-width:${panelWidths.right}px;--codex-panel-width:${panelWidths.codex}px`}>
    <div class="canvas-region">
      <EditorCanvas {session} onContextMenu={showContext} />
      <div class="editor-top-left">
        <button class="back-home" title="Back to projects" aria-label="Back to projects" onclick={backToFiles}><ChevronLeft size={15} weight="bold" /><span>Back</span></button>
        <button class="file-title" onclick={renameFile}>{session.file.name}<ChevronDown size={12} /></button>
        <button class="copy-file-id" title="Copy design ID" aria-label="Copy design ID" onclick={copyDesignId}><Copy size={12} /></button>
        <span class:bad={session.saveStatus === "error" || session.saveStatus === "conflict"}>{session.saveStatus === "saving" ? "Saving…" : session.saveStatus === "dirty" ? "Unsaved" : session.saveStatus === "conflict" ? "Save conflict" : session.saveStatus === "error" ? "Save failed" : "Saved locally"}</span>
      </div>
      <button class="panel-toggle left" title="Toggle left panel" onclick={() => togglePanel("left")}><PanelLeftClose size={15} /></button>
      <button class="panel-toggle right" title="Toggle right panel" onclick={() => togglePanel("right")}><PanelRightClose size={15} mirrored /></button>
      <Toolbar {session} onFit={() => fitCanvas("auto")} />
    </div>
    {#if panels.left}<LeftPanel {session} onCreatePage={createPage} onOpenPage={openPage} onPageMenu={showPageMenu} onLayerContext={layerContext} onPlaceIcon={placeIcon} />{/if}
    {#if panels.right}
      <aside class="right-sidebar" aria-label="Right sidebar">
        <div class="right-sidebar-tabs" role="tablist" aria-label="Sidebar views">
          <button role="tab" aria-selected={codexOpen} class:active={codexOpen} onclick={() => setCodexOpen(true)}>Codex{#if codexAttention !== "idle"}<span class={codexAttention} aria-label={`Codex ${codexAttention}`}></span>{/if}</button>
          <button role="tab" aria-selected={!codexOpen && session.inspectorTab === "design"} class:active={!codexOpen && session.inspectorTab === "design"} onclick={() => showInspectorTab("design")}>Design</button>
          <button role="tab" aria-selected={!codexOpen && session.inspectorTab === "prototype"} class:active={!codexOpen && session.inspectorTab === "prototype"} onclick={() => showInspectorTab("prototype")}>Prototype</button>
          <button class="close-sidebar" aria-label="Close right sidebar" title="Close sidebar" onclick={() => togglePanel("right")}><PanelRightClose size={14} mirrored /></button>
        </div>
        <div class="right-sidebar-content" class:hidden={codexOpen}><Inspector embedded {session} onCreatePreset={createPreset} onPresent={() => (preview = true)} onExport={exportSelection} /></div>
        <div class="right-sidebar-content" class:hidden={!codexOpen}>
          {#if codexMounted && CodexSidebarComponent}{#key session.page.id}<CodexSidebarComponent embedded workspaceId={session.file.id} pageId={session.page.id} fileName={session.file.name} visible={codexVisible} onAttentionChange={(attention: typeof codexAttention) => (codexAttention = attention)} onClose={() => setCodexOpen(false)} onEditorRpc={(method: string, params: Record<string, unknown>) => handleEditorRpc({ id: "codex-local", method, params })} />{/key}{:else}<div class="right-sidebar-loading">Loading Codex…</div>{/if}
        </div>
      </aside>
    {/if}
    {#if panels.left}<div class="panel-resizer left" role="separator" aria-label="Resize left sidebar" aria-orientation="vertical" onpointerdown={(event) => startPanelResize(event, "left")}></div>{/if}
    {#if panels.right}<div class="panel-resizer right codex" role="separator" aria-label="Resize right sidebar" aria-orientation="vertical" onpointerdown={(event) => startPanelResize(event, "right")}></div>{/if}

    {#if session.errorMessage || session.saveStatus === "conflict"}
      <div class="save-error"><div><strong>{session.saveStatus === "conflict" ? "This page changed elsewhere" : "Could not save"}</strong><span>{session.saveStatus === "conflict" ? "Choose which version should win. Neither action happens automatically." : session.errorMessage}</span></div>{#if session.saveStatus === "conflict"}<button onclick={() => resolveConflict("reload")}><RefreshCw size={14} /> Reload</button><button onclick={() => resolveConflict("keep-local")}><Save size={14} /> Keep local</button>{:else}<button onclick={retrySave}><RefreshCw size={14} /> Retry</button><button class="dismiss" onclick={dismissSaveError}><X size={14} /></button>{/if}</div>
    {/if}
    {#if notice}<div class="copy-notice"><Copy size={14} />{notice}</div>{/if}
  </div>

  {#if context}
    <div class="editor-context" role="menu" tabindex="-1" style:left={`${context.x}px`} style:top={`${context.y}px`} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && (context = null)}>
      {#if session.selectedIds.length}
        {#if contextFrame}<button onclick={() => contextAction("fullscreen")}><FullscreenIcon size={13} />Fullscreen</button><button onclick={() => contextAction("copy-image")}><Copy size={13} />Copy as image</button><hr />{/if}<button onclick={() => contextAction("copy")}><Copy size={13} />Copy<kbd>⌘C</kbd></button><button onclick={() => contextAction("cut")}>Cut<kbd>⌘X</kbd></button><button onclick={() => contextAction("paste")}>Paste here<kbd>⌘V</kbd></button><button onclick={() => contextAction("duplicate")}>Duplicate<kbd>⌘D</kbd></button><hr />
        {#if session.pages.length > 1}<button onclick={() => contextAction("move-page")}>Move to page<span>›</span></button>{/if}<button onclick={() => contextAction("front")}><MoveUp size={13} />Bring to front<kbd>]</kbd></button><button onclick={() => contextAction("back")}><MoveDown size={13} />Send to back<kbd>[</kbd></button><hr />
        {#if session.selectedNodes.some((node) => node.type === "group" || node.type === "frame")}<button onclick={() => contextAction("ungroup")}><Ungroup size={13} />Ungroup<kbd>⇧⌘G</kbd></button>{:else}<button onclick={() => contextAction("group")}><Group size={13} />Group selection<kbd>⌘G</kbd></button><button onclick={() => contextAction("frame")}>Frame selection</button>{/if}<hr />
        <button onclick={() => contextAction("visible")}>{#if session.selectedNodes.every((node) => node.visible)}<EyeOff size={13} />Hide{:else}<Eye size={13} />Show{/if}</button><button onclick={() => contextAction("lock")}>{#if session.selectedNodes.every((node) => node.locked)}<Unlock size={13} />Unlock{:else}<Lock size={13} />Lock{/if}</button><button class="danger" onclick={() => contextAction("delete")}><Trash2 size={13} />Delete<kbd>⌫</kbd></button>
      {:else}<button onclick={() => contextAction("paste")}>Paste here<kbd>⌘V</kbd></button>{/if}
    </div>
  {/if}

  {#if pageMenu}
    <div class="editor-context small" role="menu" tabindex="-1" style:left={`${pageMenu.x}px`} style:top={`${pageMenu.y}px`} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && (pageMenu = null)}><button onclick={() => pageAction("rename")}>Rename</button><button onclick={() => pageAction("duplicate")}>Duplicate</button><hr /><button class="danger" onclick={() => pageAction("delete")}>Delete page</button></div>
  {/if}

  {#if candidateRender}
    {@const candidateFrame = candidateRender.document.nodes[candidateRender.frameId]}
    {#if candidateFrame?.type === "frame"}
      <div class="candidate-render-host" aria-hidden="true">
        <svg bind:this={candidateRenderSvg} viewBox={`${candidateFrame.x} ${candidateFrame.y} ${Math.max(1, candidateFrame.width)} ${Math.max(1, candidateFrame.height)}`} preserveAspectRatio="xMidYMid meet">
          <CanvasNode node={candidateFrame} document={candidateRender.document} selectedIds={[]} imageSources={session.imageSources} interactive={false} idPrefix={candidateRender.idPrefix} />
        </svg>
      </div>
    {/if}
  {/if}

  {#if preview}<PrototypePreview {session} onClose={() => (preview = false)} />{/if}
  {#if fullscreenFrameId}<FrameFullscreenPreview {session} frameId={fullscreenFrameId} onClose={() => (fullscreenFrameId = null)} />{/if}
{/if}

<style>
  .editor-shell { position: fixed; inset: 0; background: #626262; overflow: hidden; }.canvas-region { position: absolute; inset: 0 var(--right-panel-width,280px) 0 var(--left-panel-width,297px); transition: left 180ms ease, right 180ms ease; }.left-hidden .canvas-region { left: 0; }.right-hidden .canvas-region { right: 0; }.codex-open .canvas-region { right: var(--codex-panel-width,390px); }
  .right-sidebar { position: absolute; z-index: 30; inset: 0 0 0 auto; width: var(--codex-panel-width,390px); display: flex; flex-direction: column; overflow: hidden; border-left: 1px solid #414146; background: #272729; color: #ececef; box-shadow: -8px 0 24px #0002; }.right-sidebar-tabs { height: 35px; flex: 0 0 35px; padding: 0 7px; display: flex; align-items: stretch; border-bottom: 1px solid #3b3b40; background: #252527; }.right-sidebar-tabs > button { position: relative; min-width: 58px; padding: 1px 9px 0; border: 0; background: transparent; color: #85858d; cursor: pointer; font-size: var(--text-caption); font-weight: var(--weight-medium); letter-spacing: .035em; text-transform: uppercase; }.right-sidebar-tabs > button:hover { color: #d1d1d6; }.right-sidebar-tabs > button.active { color: #ededf0; }.right-sidebar-tabs > button.active::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: 0; height: 1px; background: #79b8d1; }.right-sidebar-tabs > button > span { position: absolute; top: 8px; right: 2px; width: 6px; height: 6px; border-radius: 50%; background: #8b8b94; }.right-sidebar-tabs > button > span.working { background: #60a5fa; }.right-sidebar-tabs > button > span.approval { background: #f59e0b; }.right-sidebar-tabs > button > span.input { background: #a78bfa; }.right-sidebar-tabs > button > span.complete { background: #4ade80; }.right-sidebar-tabs > button > span.error { background: #f87171; }.right-sidebar-tabs > button.close-sidebar { width: 29px; min-width: 29px; height: 29px; align-self: center; margin-left: auto; padding: 0; border-radius: 5px; display: grid; place-items: center; color: #85858d; }.right-sidebar-tabs > button.close-sidebar::after { display: none; }.right-sidebar-tabs > button.close-sidebar:hover { background: #36363a; color: #eee; }.right-sidebar-content { min-height: 0; flex: 1; position: relative; }.right-sidebar-content.hidden { display: none; }.right-sidebar-loading { height: 100%; display: grid; place-items: center; color: #777780; font-size: var(--text-control); }
  :global(body.resizing-panels) .canvas-region { transition: none; }
  .editor-top-left { position: absolute; z-index: 35; top: 0; left: 0; height: 42px; background: #292929e8; border: 1px solid #444; border-top: 0; border-left: 0; border-radius: 0 0 7px 0; display: flex; align-items: center; padding: 0 7px; gap: 3px; box-shadow: 0 4px 14px #0003; }.editor-top-left button { border: 0; background: transparent; color: #ddd; height: 29px; border-radius: 5px; display: flex; align-items: center; cursor: pointer; }.editor-top-left button:hover { background: #3a3a3a; }.editor-top-left .back-home { gap: 3px; padding: 0 7px 0 5px; color: #b8b8be; font-size: var(--text-caption); font-weight: var(--weight-medium); }.editor-top-left .back-home:hover { color: #f2f2f4; }.editor-top-left .file-title { max-width: 180px; gap: 5px; font-size: var(--text-control); font-weight: var(--weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.editor-top-left .copy-file-id { width: 27px; justify-content: center; color: #929299; }.editor-top-left > span { color: #6f6f76; font-size: var(--text-caption); margin-left: 4px; }.editor-top-left > span.bad { color: #fca5a5; }
  .panel-toggle { position: absolute; z-index: 35; top: 8px; width: 29px; height: 28px; border: 1px solid #4a4a4a; background: #292929; color: #aaa; border-radius: 5px; display: grid; place-items: center; cursor: pointer; }.panel-toggle.left { left: 7px; opacity: 0; pointer-events: none; }.left-hidden .panel-toggle.left { opacity: 1; pointer-events: auto; }.panel-toggle.right { right: 7px; opacity: 0; pointer-events: none; }.right-hidden .panel-toggle.right { opacity: 1; pointer-events: auto; }
  .panel-resizer { position: absolute; z-index: 61; top: 0; bottom: 0; width: 7px; cursor: col-resize; touch-action: none; }.panel-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; transition: background 120ms ease; }.panel-resizer:hover::after { background: #6f6f77; }.panel-resizer.left { left: calc(var(--left-panel-width,297px) - 7px); }.panel-resizer.right { right: calc(var(--right-panel-width,280px) - 7px); }.panel-resizer.right.codex { right: calc(var(--codex-panel-width,390px) - 7px); }
  .loading, .error-screen { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1d1d1d; }
  .screen-brand { width: 38px; height: 54px; object-fit: contain; margin-bottom: 19px; opacity: .9; filter: drop-shadow(0 7px 14px #0009); }.error-icon { width: 58px; height: 58px; display: grid; place-items: center; border: 1px solid #512727; background: #321d1d; color: #f87171; border-radius: 15px; }.error-screen h1 { font-size: var(--text-large); margin: 17px 0 4px; }.error-screen p { color: #888; font-size: var(--text-control); }.error-screen button { margin-top: 13px; height: 32px; border: 1px solid #414141; border-radius: 6px; background: #2c2c2c; color: white; display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 0 11px; font-size: var(--text-control); }
  .editor-context { position: fixed; z-index: 100; width: 225px; padding: 6px; border: 1px solid #444; border-radius: 7px; background: #202020; box-shadow: 0 15px 45px #0009; }.editor-context.small { width: 165px; }.editor-context button { width: 100%; min-height: 31px; border: 0; border-radius: 4px; background: transparent; color: #eee; padding: 0 8px; display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: var(--text-control); }.editor-context button:hover { background: #373737; }.editor-context kbd,.editor-context button > span { margin-left: auto; color: #888; font: inherit; }.editor-context hr { height: 1px; border: 0; background: #3d3d3d; margin: 5px -6px; }.editor-context .danger { color: #fca5a5; }
  .save-error { position: fixed; z-index: 80; left: 50%; top: 13px; transform: translateX(-50%); min-width: 380px; min-height: 48px; background: #3a2020; border: 1px solid #7f3737; border-radius: 8px; box-shadow: 0 8px 30px #0007; display: flex; align-items: center; gap: 10px; padding: 8px 9px 8px 13px; }.save-error > div { flex: 1; display: flex; flex-direction: column; }.save-error strong { font-size: var(--text-control); }.save-error span { color: #d4a1a1; font-size: var(--text-caption); margin-top: 3px; }.save-error button { height: 28px; border: 0; border-radius: 5px; background: #693333; color: #fff; display: flex; align-items: center; gap: 5px; padding: 0 9px; cursor: pointer; font-size: var(--text-small); }.save-error .dismiss { width: 28px; padding: 0; justify-content: center; background: transparent; }
  .copy-notice { position: fixed; z-index: 90; left: 50%; bottom: 24px; transform: translateX(-50%); min-height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid #4a4a4a; border-radius: 7px; background: #252525; color: #f4f4f5; box-shadow: 0 8px 28px #0008; font-size: var(--text-small); }
  .candidate-render-host { position: fixed; left: -100000px; top: -100000px; width: 2048px; height: 2048px; overflow: hidden; pointer-events: none; }
  .candidate-render-host svg { display: block; width: 100%; height: 100%; }
  @media (max-width: 1050px) { .canvas-region { left: 56px; }.editor-shell :global(.left-shell) { width: 56px; grid-template-columns: 56px 0; }.editor-shell :global(.left-shell .panel) { display: none; }.panel-resizer.left { display: none; } }
</style>
