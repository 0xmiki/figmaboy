<script lang="ts">
  import { onMount } from "svelte";
  import type { DesignNode, Rect, TextNode, Tool } from "$lib/domain";
  import { defaultNode } from "$lib/domain";
  import { drawingParentFrame, frameAtPoint, intersects, normalizeRect, screenToWorld, selectionBounds, worldBounds, worldToNodeLocal } from "$lib/geometry";
  import { syncTextSize } from "$lib/text-layout";
  import type { Point } from "$lib/geometry";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";

  let { session, onContextMenu }: { session: EditorSession; onContextMenu: (event: MouseEvent, world: Point) => void } = $props();
  let host = $state<HTMLDivElement>();
  let marquee = $state<Rect | null>(null);
  let spacePressed = $state(false);
  let mode = $state<"idle" | "pan" | "draw" | "text" | "edit-text" | "move" | "marquee" | "resize" | "rotate">("idle");
  let startScreen: Point = { x: 0, y: 0 };
  let startWorld: Point = { x: 0, y: 0 };
  let lastWorld: Point = { x: 0, y: 0 };
  let draftId: string | null = null;
  let createdTextId: string | null = null;
  let pendingTextEditId: string | null = null;
  let lastNodePress = { id: "", at: -Infinity };
  let draftParentId: string | null = null;
  let draftStart: Point = { x: 0, y: 0 };
  let handle = "";
  let startBounds: Rect | null = null;
  let startNodes = new Map<string, DesignNode>();
  let startNodeBounds = new Map<string, Rect>();
  let dragSourceNodes = new Map<string, DesignNode>();
  let dragDuplicated = false;
  let startViewport = { x: 0, y: 0 };
  let moveFrame = 0;
  let gestureStartZoom = 1;

  const viewport = $derived(session.document.viewport);
  const selectedBounds = $derived(selectionBounds(session.document, session.selectedIds));
  const unclippedFrameIds = $derived.by(() => {
    const ids = new Set<string>();
    if (mode !== "move") return ids;
    for (const selectedId of session.selectedIds) {
      const selectedNode = session.document.nodes[selectedId];
      if (!selectedNode) continue;
      const bounds = worldBounds(session.document, selectedNode);
      let id: string | null = selectedNode.parentId;
      while (id) {
        const node: DesignNode | undefined = session.document.nodes[id];
        if (!node) break;
        if (node.type === "frame" && !intersects(bounds, worldBounds(session.document, node))) ids.add(node.id);
        id = node.parentId;
      }
    }
    return ids;
  });
  const editingNode = $derived(session.editingTextId ? session.document.nodes[session.editingTextId] : null);
  const editingBounds = $derived(editingNode ? worldBounds(session.document, editingNode) : null);

  onMount(() => {
    if (!session.document.rootIds.length && host) {
      session.document.viewport.x = host.clientWidth / 2;
      session.document.viewport.y = host.clientHeight / 2;
    }
    const target = host;
    if (!target) return;
    const startGesture = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = viewport.zoom;
    };
    const changeGesture = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      const rect = target.getBoundingClientRect();
      const point = {
        x: (gesture.clientX ?? rect.left + rect.width / 2) - rect.left,
        y: (gesture.clientY ?? rect.top + rect.height / 2) - rect.top,
      };
      zoomAtPoint(point, gestureStartZoom * (gesture.scale ?? 1));
    };
    target.addEventListener("gesturestart", startGesture, { passive: false });
    target.addEventListener("gesturechange", changeGesture, { passive: false });
    let disposed = false;
    let unlistenNative: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<{ phase: "start" | "change" | "end"; scale: number; x: number; y: number }>(
          "native-touchpad-zoom",
          ({ payload }) => {
            if (payload.phase === "start") {
              gestureStartZoom = viewport.zoom;
              return;
            }
            if (payload.phase !== "change") return;
            const rect = target.getBoundingClientRect();
            zoomAtPoint(
              { x: payload.x - rect.left, y: payload.y - rect.top },
              gestureStartZoom * payload.scale,
            );
          },
        ),
      ).then((unlisten) => {
        if (disposed) unlisten();
        else unlistenNative = unlisten;
      });
    }
    return () => {
      disposed = true;
      unlistenNative?.();
      target.removeEventListener("gesturestart", startGesture);
      target.removeEventListener("gesturechange", changeGesture);
    };
  });

  function pointFromEvent(event: MouseEvent | PointerEvent | WheelEvent): Point {
    const rect = host?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function worldFromEvent(event: MouseEvent | PointerEvent | WheelEvent): Point {
    return screenToWorld(pointFromEvent(event), viewport);
  }

  function begin(event: PointerEvent, hitId: string | null = null) {
    if (event.button === 2) return;
    if (session.editingTextId) finishTextEditing();
    startScreen = pointFromEvent(event);
    startWorld = worldFromEvent(event);
    lastWorld = startWorld;

    if (event.button === 1 || session.activeTool === "hand" || spacePressed) {
      mode = "pan";
      startViewport = { x: viewport.x, y: viewport.y };
      host?.setPointerCapture(event.pointerId);
      return;
    }

    if (session.activeTool === "select") {
      session.select(null);
      mode = "marquee";
      marquee = { x: startWorld.x, y: startWorld.y, width: 0, height: 0 };
      host?.setPointerCapture(event.pointerId);
      return;
    }

    if (session.activeTool === "image") {
      draftParentId = drawingParentFrame(session.document, hitId);
      void importImage(startWorld, draftParentId);
      return;
    }

    draftParentId = drawingParentFrame(session.document, hitId);
    draftStart = worldToNodeLocal(session.document, draftParentId, startWorld);

    const type = session.activeTool as Exclude<Tool, "select" | "hand" | "image">;
    const node = defaultNode(type, draftStart.x, draftStart.y, type === "text" ? { text: "", width: 1 } as Partial<TextNode> : {});
    if (type === "text") {
      mode = "text";
      host?.setPointerCapture(event.pointerId);
      return;
    }
    // Drawing tools start as a zero-sized draft. The pointer gesture, not a
    // fallback click size, is the source of truth for the final geometry.
    node.width = 0;
    node.height = 0;
    session.beginGesture();
    node.parentId = draftParentId;
    session.document.nodes[node.id] = node;
    const parent = draftParentId ? session.document.nodes[draftParentId] : null;
    if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(node.id);
    else session.document.rootIds.push(node.id);
    session.selectedIds = [node.id];
    draftId = node.id;
    mode = "draw";
    host?.setPointerCapture(event.pointerId);
  }

  async function importImage(point: Point, parentId: string | null = draftParentId) {
    const asset = await import("$lib/repository").then(({ repository }) => repository().importImage());
    if (!asset) { session.activeTool = "select"; return; }
    session.imageSources[asset.id] = asset.dataUrl;
    const max = 520;
    const scale = Math.min(1, max / Math.max(asset.width, asset.height));
    const local = worldToNodeLocal(session.document, parentId, point);
    const node = defaultNode("image", local.x, local.y, {
      width: Math.max(40, asset.width * scale), height: Math.max(40, asset.height * scale),
      assetId: asset.id, mime: asset.mime,
    });
    session.addNode(node, parentId);
  }

  function nodePointerDown(event: PointerEvent, id: string) {
    if (event.button === 1 || session.activeTool === "hand" || spacePressed) {
      begin(event, id);
      return;
    }
    if (event.button !== 0) return;
    if (session.editingTextId) finishTextEditing();
    if (session.activeTool !== "select") {
      if (session.activeTool === "image") {
        draftParentId = drawingParentFrame(session.document, id);
        void importImage(worldFromEvent(event), draftParentId);
      } else begin(event, id);
      return;
    }
    const node = session.document.nodes[id];
    if (!node || node.locked) return;
    const doublePress = lastNodePress.id === id && event.timeStamp - lastNodePress.at < 500;
    lastNodePress = doublePress ? { id: "", at: -Infinity } : { id, at: event.timeStamp };
    if (node.type === "text" && (event.detail >= 2 || doublePress)) {
      pendingTextEditId = id;
      mode = "edit-text";
      host?.setPointerCapture(event.pointerId);
      return;
    }
    startScreen = pointFromEvent(event);
    startWorld = worldFromEvent(event);
    lastWorld = startWorld;
    session.select(id, event.shiftKey);
    if (!session.selectedIds.includes(id)) return;
    session.beginGesture();
    startNodes = new Map(session.selectedIds.map((selectedId) => [selectedId, JSON.parse(JSON.stringify(session.document.nodes[selectedId])) as DesignNode]));
    startNodeBounds = new Map([...startNodes].map(([id, node]) => [id, worldBounds(session.document, node)]));
    dragSourceNodes = new Map(startNodes);
    startBounds = selectionBounds(session.document, session.selectedIds);
    dragDuplicated = false;
    if (event.altKey) duplicateDragSelection();
    mode = "move";
    host?.setPointerCapture(event.pointerId);
  }

  function nodeDoubleClick(_event: MouseEvent, id: string) {
    const node = session.document.nodes[id];
    if (node?.type === "text") {
      session.select(id);
      session.editingTextId = id;
      createdTextId = null;
      session.beginGesture();
    } else if (node?.type === "group" || node?.type === "frame") {
      const first = node.childIds[0];
      if (first) session.select(first);
    }
  }

  function startHandle(event: PointerEvent, nextHandle: string) {
    event.stopPropagation();
    if (session.activeTool !== "select") {
      begin(event, session.selectedIds[0] ?? null);
      return;
    }
    startScreen = pointFromEvent(event);
    startWorld = worldFromEvent(event);
    startBounds = selectedBounds ? { ...selectedBounds } : null;
    startNodes = new Map(session.selectedIds.map((id) => [id, JSON.parse(JSON.stringify(session.document.nodes[id])) as DesignNode]));
    startNodeBounds = new Map([...startNodes].map(([id, node]) => [id, worldBounds(session.document, node)]));
    handle = nextHandle;
    mode = nextHandle === "rotate" ? "rotate" : "resize";
    session.beginGesture();
    host?.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (mode === "idle") return;
    const screen = pointFromEvent(event);
    const world = worldFromEvent(event);
    lastWorld = world;
    cancelAnimationFrame(moveFrame);
    const shiftKey = event.shiftKey;
    const altKey = event.altKey;
    moveFrame = requestAnimationFrame(() => applyPointerMove(screen, world, shiftKey, altKey));
  }

  function applyPointerMove(screen: Point, world: Point, constrained: boolean, fromCenter: boolean) {
    if (mode === "pan") {
      viewport.x = startViewport.x + screen.x - startScreen.x;
      viewport.y = startViewport.y + screen.y - startScreen.y;
      return;
    }
    if (mode === "marquee") {
      marquee = normalizeRect(startWorld, world);
      return;
    }
    if (mode === "text" || mode === "edit-text") {
      return;
    }
    if (mode === "draw" && draftId) {
      const node = session.document.nodes[draftId];
      if (!node) return;
      const local = worldToNodeLocal(session.document, draftParentId, world);
      let width = local.x - draftStart.x;
      let height = local.y - draftStart.y;
      if (constrained && node.type !== "line" && node.type !== "arrow") {
        const size = Math.max(Math.abs(width), Math.abs(height));
        width = Math.sign(width || 1) * size;
        height = Math.sign(height || 1) * size;
      }
      node.x = width < 0 ? local.x : draftStart.x;
      node.y = height < 0 ? local.y : draftStart.y;
      node.width = Math.abs(width);
      node.height = node.type === "line" || node.type === "arrow" ? height : Math.abs(height);
      session.gestureChanged();
      return;
    }
    if (mode === "move") moveSelection(world, constrained, fromCenter);
    if (mode === "resize") resizeSelection(world, constrained, fromCenter);
    if (mode === "rotate") rotateSelection(world, constrained);
  }

  function duplicateDragSelection() {
    if (dragDuplicated) return;
    for (const [id, original] of dragSourceNodes) {
      const node = session.document.nodes[id];
      if (node) { node.x = original.x; node.y = original.y; }
    }
    session.duplicateSelection({ x: 0, y: 0 }, false);
    startNodes = new Map(session.selectedIds.map((id) => [id, JSON.parse(JSON.stringify(session.document.nodes[id])) as DesignNode]));
    startNodeBounds = new Map([...startNodes].map(([id, node]) => [id, worldBounds(session.document, node)]));
    startBounds = selectionBounds(session.document, session.selectedIds);
    dragDuplicated = true;
  }

  function moveSelection(world: Point, constrain: boolean, duplicate: boolean) {
    if (duplicate && !dragDuplicated) duplicateDragSelection();
    let dx = world.x - startWorld.x;
    let dy = world.y - startWorld.y;
    if (constrain) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    session.guides = { x: null, y: null };
    if (startBounds && session.selectedIds.length === 1) {
      const otherBounds = Object.values(session.document.nodes).filter((node) => !session.selectedIds.includes(node.id) && node.visible).map((node) => worldBounds(session.document, node));
      const threshold = 5 / viewport.zoom;
      const xCandidates = otherBounds.flatMap((rect) => [rect.x, rect.x + rect.width / 2, rect.x + rect.width]);
      const yCandidates = otherBounds.flatMap((rect) => [rect.y, rect.y + rect.height / 2, rect.y + rect.height]);
      const targetX = startBounds.x + dx;
      const targetY = startBounds.y + dy;
      const nearestX = xCandidates.reduce<{ d: number; value: number | null }>((best, value) => Math.abs(value - targetX) < best.d ? { d: Math.abs(value - targetX), value } : best, { d: Infinity, value: null });
      const nearestY = yCandidates.reduce<{ d: number; value: number | null }>((best, value) => Math.abs(value - targetY) < best.d ? { d: Math.abs(value - targetY), value } : best, { d: Infinity, value: null });
      if (nearestX.value !== null && nearestX.d <= threshold) { dx = nearestX.value - startBounds.x; session.guides.x = nearestX.value; }
      if (nearestY.value !== null && nearestY.d <= threshold) { dy = nearestY.value - startBounds.y; session.guides.y = nearestY.value; }
    }
    for (const [id, original] of startNodes) {
      const node = session.document.nodes[id];
      if (!node || node.locked) continue;
      const localStart = worldToNodeLocal(session.document, original.parentId, startWorld);
      const localEnd = worldToNodeLocal(session.document, original.parentId, { x: startWorld.x + dx, y: startWorld.y + dy });
      node.x = original.x + localEnd.x - localStart.x;
      node.y = original.y + localEnd.y - localStart.y;
    }
    session.gestureChanged();
  }

  function resizeSelection(world: Point, constrain: boolean, fromCenter: boolean) {
    if (!startBounds || startBounds.width === 0 || startBounds.height === 0) return;
    let left = startBounds.x;
    let top = startBounds.y;
    let right = startBounds.x + startBounds.width;
    let bottom = startBounds.y + startBounds.height;
    if (handle.includes("w")) left = world.x;
    if (handle.includes("e")) right = world.x;
    if (handle.includes("n")) top = world.y;
    if (handle.includes("s")) bottom = world.y;
    if (fromCenter) {
      const centerX = startBounds.x + startBounds.width / 2;
      const centerY = startBounds.y + startBounds.height / 2;
      if (handle.includes("w") || handle.includes("e")) {
        const half = Math.abs((handle.includes("w") ? left : right) - centerX);
        left = centerX - half;
        right = centerX + half;
      }
      if (handle.includes("n") || handle.includes("s")) {
        const half = Math.abs((handle.includes("n") ? top : bottom) - centerY);
        top = centerY - half;
        bottom = centerY + half;
      }
    }
    if (right < left) [left, right] = [right, left];
    if (bottom < top) [top, bottom] = [bottom, top];
    let width = Math.max(1, right - left);
    let height = Math.max(1, bottom - top);
    if (constrain) {
      const ratio = startBounds.width / startBounds.height;
      if (width / height > ratio) width = height * ratio; else height = width / ratio;
      if (fromCenter) {
        const centerX = startBounds.x + startBounds.width / 2;
        const centerY = startBounds.y + startBounds.height / 2;
        left = centerX - width / 2;
        top = centerY - height / 2;
      } else {
        if (handle.includes("w")) left = right - width;
        if (handle.includes("e")) right = left + width;
        if (handle.includes("n")) top = bottom - height;
        if (handle.includes("s")) bottom = top + height;
      }
    }
    const sx = width / startBounds.width;
    const sy = height / startBounds.height;
    for (const [id, original] of startNodes) {
      const node = session.document.nodes[id];
      if (!node || node.locked) continue;
      const originalBounds = startNodeBounds.get(id);
      if (!originalBounds) continue;
      const nextWorldPosition = {
        x: left + (originalBounds.x - startBounds.x) * sx,
        y: top + (originalBounds.y - startBounds.y) * sy,
      };
      const nextLocalPosition = worldToNodeLocal(session.document, original.parentId, nextWorldPosition);
      node.x = nextLocalPosition.x;
      node.y = nextLocalPosition.y;
      node.width = Math.max(1, original.width * sx);
      if (node.type === "line" || node.type === "arrow") node.height = original.height * sy; else node.height = Math.max(1, original.height * sy);
      if (node.type === "text") {
        node.autoWidth = false;
        syncTextSize(node);
      }
    }
    session.gestureChanged();
  }

  function rotateSelection(world: Point, snap: boolean) {
    if (!startBounds) return;
    const center = { x: startBounds.x + startBounds.width / 2, y: startBounds.y + startBounds.height / 2 };
    const startAngle = Math.atan2(startWorld.y - center.y, startWorld.x - center.x);
    const nextAngle = Math.atan2(world.y - center.y, world.x - center.x);
    let delta = ((nextAngle - startAngle) * 180) / Math.PI;
    if (snap) delta = Math.round(delta / 15) * 15;
    for (const [id, original] of startNodes) {
      const node = session.document.nodes[id];
      if (node && !node.locked) node.rotation = original.rotation + delta;
    }
    session.gestureChanged();
  }

  function end(event: PointerEvent) {
    cancelAnimationFrame(moveFrame);
    const endScreen = pointFromEvent(event);
    const endWorld = worldFromEvent(event);
    const dragged = Math.hypot(endScreen.x - startScreen.x, endScreen.y - startScreen.y) >= 3;
    // Flush the final pointer coordinate; a queued animation frame may not
    // have run before pointerup on quick drags.
    if (mode !== "draw" || dragged) applyPointerMove(endScreen, endWorld, event.shiftKey, event.altKey);
    if (mode === "marquee" && marquee) {
      const ids = Object.values(session.document.nodes).filter((node) => node.visible && !node.locked && intersects(marquee!, worldBounds(session.document, node))).map((node) => node.id);
      session.selectedIds = ids;
      marquee = null;
    }
    if (mode === "edit-text" && pendingTextEditId) {
      session.select(pendingTextEditId);
      session.editingTextId = pendingTextEditId;
      createdTextId = null;
      pendingTextEditId = null;
      session.beginGesture();
    } else if (mode === "text") {
      const localEnd = worldToNodeLocal(session.document, draftParentId, endWorld);
      const node = defaultNode("text", draftStart.x, draftStart.y, { text: "", width: 1 });
      if (node.type === "text" && dragged) {
        node.x = Math.min(draftStart.x, localEnd.x);
        node.y = Math.min(draftStart.y, localEnd.y);
        node.width = Math.max(1, Math.abs(localEnd.x - draftStart.x));
        node.height = Math.max(node.fontSize * node.lineHeight, Math.abs(localEnd.y - draftStart.y));
        node.autoWidth = false;
      }
      session.addNode(node, draftParentId);
      session.editingTextId = node.id;
      createdTextId = node.id;
      session.beginGesture();
      draftParentId = null;
    } else if (mode === "draw" && draftId) {
      if (!dragged) {
        session.cancelGesture();
        session.selectedIds = [];
      } else {
        session.activeTool = "select";
        session.commitGesture();
      }
      draftId = null;
      draftParentId = null;
    } else if (mode === "move" || mode === "resize" || mode === "rotate") {
      if (mode === "move" && dragged && !spacePressed) {
        let targetFrameId = frameAtPoint(session.document, endWorld, session.selectedIds);
        const movedBounds = selectionBounds(session.document, session.selectedIds);
        const parentIds = new Set(session.selectedNodes.map((node) => node.parentId));
        const currentParentId = parentIds.size === 1 ? [...parentIds][0] : null;
        const currentParent = currentParentId ? session.document.nodes[currentParentId] : null;
        if (
          movedBounds &&
          currentParent?.type === "frame" &&
          targetFrameId !== currentParent.id &&
          intersects(movedBounds, worldBounds(session.document, currentParent))
        ) {
          targetFrameId = currentParent.id;
        }
        if (targetFrameId && movedBounds) {
          const targetBounds = worldBounds(session.document, session.document.nodes[targetFrameId]);
          if (movedBounds.width > targetBounds.width || movedBounds.height > targetBounds.height) targetFrameId = null;
        }
        session.reparentSelection(targetFrameId, false);
      }
      session.commitGesture();
    } else if (mode === "pan") session.gestureChanged();
    session.guides = { x: null, y: null };
    mode = "idle";
    try { host?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    const point = pointFromEvent(event);
    if (event.ctrlKey || event.metaKey) {
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      zoomAtPoint(point, viewport.zoom * Math.exp(-delta * .002));
    } else {
      viewport.x -= event.deltaX;
      viewport.y -= event.deltaY;
      session.gestureChanged();
    }
  }

  function zoomAtPoint(point: Point, requestedZoom: number) {
    const world = screenToWorld(point, viewport);
    const next = Math.min(8, Math.max(.05, requestedZoom));
    viewport.x = point.x - world.x * next;
    viewport.y = point.y - world.y * next;
    viewport.zoom = next;
    session.gestureChanged();
  }

  function contextMenu(event: MouseEvent) {
    event.preventDefault();
    onContextMenu(event, worldFromEvent(event));
  }

  function updateText(event: Event & { currentTarget: HTMLTextAreaElement }) {
    const node = editingNode;
    if (node?.type !== "text") return;
    node.text = event.currentTarget.value;
    syncTextSize(node);
    session.gestureChanged();
  }

  function textKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
      event.preventDefault();
      textBlur();
    }
  }

  function finishTextEditing() {
    const id = session.editingTextId;
    if (!id) return;
    const removeEmpty = createdTextId === id && session.document.nodes[id]?.type === "text" && !(session.document.nodes[id] as TextNode).text.length;
    session.editingTextId = null;
    session.commitGesture();
    createdTextId = null;
    if (removeEmpty && session.document.nodes[id]) {
      session.selectedIds = [id];
      session.deleteSelection();
    }
  }

  function textBlur(event?: FocusEvent) {
    const next = event?.relatedTarget;
    if (next instanceof Element && next.closest("[data-editor-inspector]")) {
      // Inspector controls style the active text node. Keep the editor mounted
      // while focus is in that panel, but close the current typing gesture so
      // the inspector change gets its own undo entry.
      session.commitGesture();
      return;
    }
    finishTextEditing();
  }

  function keyDown(event: KeyboardEvent) {
    if (event.code === "Space" && !event.repeat && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      spacePressed = true;
      event.preventDefault();
    }
  }

  function focus(node: HTMLTextAreaElement) {
    queueMicrotask(() => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }
</script>

<svelte:window onpointermove={move} onpointerup={end} onkeydown={keyDown} onkeyup={(event) => event.code === "Space" && (spacePressed = false)} onblur={() => (spacePressed = false)} />

<div id="design-canvas" role="application" aria-label="Design canvas" class:grabbing={mode === "pan"} class:crosshair={!["select", "hand"].includes(session.activeTool)} class="canvas-host" bind:this={host} onpointerdown={begin} onwheel={wheel} oncontextmenu={contextMenu}>
  <svg width="100%" height="100%" aria-label="Design canvas">
    <defs>
      <pattern id="grid" width={8 * viewport.zoom} height={8 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x % (8 * viewport.zoom)} y={viewport.y % (8 * viewport.zoom)}>
        <circle cx=".5" cy=".5" r=".5" fill="#797979" opacity={viewport.zoom > .65 ? .25 : 0} />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#626262" />
    <rect width="100%" height="100%" fill="url(#grid)" />
    <g class="world" transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
      {#each session.document.rootIds as id}
        {#if session.document.nodes[id]}
          <CanvasNode node={session.document.nodes[id]} document={session.document} selectedIds={session.selectedIds} imageSources={session.imageSources} {unclippedFrameIds} onNodePointerDown={nodePointerDown} onNodeDoubleClick={nodeDoubleClick} />
        {/if}
      {/each}

      {#if session.guides.x !== null}<line class="guide" x1={session.guides.x} y1={-100000} x2={session.guides.x} y2={100000} stroke-width={1 / viewport.zoom} />{/if}
      {#if session.guides.y !== null}<line class="guide" x1={-100000} y1={session.guides.y} x2={100000} y2={session.guides.y} stroke-width={1 / viewport.zoom} />{/if}

      {#if selectedBounds && !session.editingTextId}
        {@const size = 8 / viewport.zoom}
        <g class="selection-ui">
          <rect x={selectedBounds.x} y={selectedBounds.y} width={Math.max(selectedBounds.width, 1 / viewport.zoom)} height={Math.max(selectedBounds.height, 1 / viewport.zoom)} fill="none" stroke="#0d99ff" stroke-width={1 / viewport.zoom} />
          <line x1={selectedBounds.x + selectedBounds.width / 2} y1={selectedBounds.y} x2={selectedBounds.x + selectedBounds.width / 2} y2={selectedBounds.y - 22 / viewport.zoom} stroke="#0d99ff" stroke-width={1 / viewport.zoom} />
          <circle role="button" aria-label="Rotate selection" tabindex="-1" cx={selectedBounds.x + selectedBounds.width / 2} cy={selectedBounds.y - 26 / viewport.zoom} r={4 / viewport.zoom} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, "rotate")} class="rotate-handle" />
          {#each [
            ["nw", selectedBounds.x, selectedBounds.y], ["n", selectedBounds.x + selectedBounds.width / 2, selectedBounds.y], ["ne", selectedBounds.x + selectedBounds.width, selectedBounds.y],
            ["e", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height / 2], ["se", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height],
            ["s", selectedBounds.x + selectedBounds.width / 2, selectedBounds.y + selectedBounds.height], ["sw", selectedBounds.x, selectedBounds.y + selectedBounds.height], ["w", selectedBounds.x, selectedBounds.y + selectedBounds.height / 2],
          ] as item}
            <rect role="button" aria-label={`Resize ${item[0]}`} tabindex="-1" class={`handle handle-${item[0]}`} x={Number(item[1]) - size / 2} y={Number(item[2]) - size / 2} width={size} height={size} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, String(item[0]))} />
          {/each}
          {#if session.selectedIds.length === 1}
            <g transform={`translate(${selectedBounds.x + selectedBounds.width / 2} ${selectedBounds.y + selectedBounds.height + 8 / viewport.zoom}) scale(${1 / viewport.zoom})`}>
              <rect x="-28" width="56" height="17" rx="3" fill="#0d99ff" /><text y="12" text-anchor="middle" fill="white" font-size="9">{Math.round(selectedBounds.width)} × {Math.round(selectedBounds.height)}</text>
            </g>
          {/if}
        </g>
      {/if}
      {#if marquee}<rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="#0d99ff18" stroke="#0d99ff" stroke-width={1 / viewport.zoom} />{/if}
    </g>
  </svg>

  {#if editingNode?.type === "text" && editingBounds}
    <textarea
      class="text-editor"
      aria-label="Edit text"
      use:focus
      value={editingNode.text}
      rows="1"
      wrap={editingNode.autoWidth ? "off" : "soft"}
      spellcheck="false"
      oninput={updateText}
      onblur={textBlur}
      onfocus={() => session.beginGesture()}
      onkeydown={textKeyDown}
      onpointerdown={(event) => event.stopPropagation()}
      onclick={(event) => event.stopPropagation()}
      ondblclick={(event) => event.stopPropagation()}
      style:left={`${viewport.x + editingBounds.x * viewport.zoom}px`}
      style:top={`${viewport.y + editingBounds.y * viewport.zoom}px`}
      style:width={`${Math.max(80, editingBounds.width * viewport.zoom)}px`}
      style:height={`${Math.max(30, editingBounds.height * viewport.zoom)}px`}
      style:font-family={editingNode.fontFamily}
      style:font-size={`${editingNode.fontSize * viewport.zoom}px`}
      style:font-weight={editingNode.fontWeight}
      style:line-height={editingNode.lineHeight}
      style:letter-spacing={`${editingNode.letterSpacing * viewport.zoom}px`}
      style:text-align={editingNode.textAlign}
      style:white-space={editingNode.autoWidth ? "pre" : "pre-wrap"}
      style:overflow-wrap={editingNode.autoWidth ? "normal" : "break-word"}
      style:color={editingNode.fill?.type === "solid" ? editingNode.fill.color : "#18181b"}
    ></textarea>
  {/if}
</div>

<style>
  .canvas-host { position: absolute; inset: 0; overflow: hidden; cursor: default; touch-action: none; }.canvas-host.grabbing { cursor: grabbing; }.canvas-host.crosshair { cursor: crosshair; }
  svg { display: block; }.guide { stroke: #ff4ecd; vector-effect: non-scaling-stroke; pointer-events: none; }.selection-ui { pointer-events: none; }.selection-ui .handle, .selection-ui .rotate-handle { pointer-events: all; }.handle-nw,.handle-se { cursor: nwse-resize; }.handle-ne,.handle-sw { cursor: nesw-resize; }.handle-n,.handle-s { cursor: ns-resize; }.handle-e,.handle-w { cursor: ew-resize; }.rotate-handle { cursor: grab; }
  .text-editor { position: absolute; z-index: 12; padding: 0; margin: 0; resize: none; overflow: hidden; border: 1px solid #0d99ff; outline: 0; background: transparent; caret-color: #0d99ff; white-space: pre; user-select: text; transform-origin: top left; }
</style>
