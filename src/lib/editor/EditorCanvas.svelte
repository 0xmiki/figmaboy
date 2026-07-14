<script lang="ts">
  import { onMount } from "svelte";
  import type { DesignNode, Rect, TextNode, Tool } from "$lib/domain";
  import { defaultNode } from "$lib/domain";
  import { containsRect, drawingParentFrame, frameAtPoint, intersects, nodeMatrix, normalizeRect, rectContainsPoint, screenToWorld, selectionBounds, transformPoint, worldBounds, worldMatrix, worldToNodeLocal } from "$lib/geometry";
  import { syncTextSize } from "$lib/text-layout";
  import type { Point } from "$lib/geometry";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import CanvasNode from "$lib/editor/CanvasNode.svelte";
  import { canvasSelectionTarget, isCanvasNodeVisible } from "$lib/editor/canvas-selection";

  let { session, onContextMenu }: { session: EditorSession; onContextMenu: (event: MouseEvent, world: Point, hitId?: string) => void } = $props();
  let host = $state<HTMLDivElement>();
  let viewportElement = $state<SVGSVGElement>();
  let gridPattern = $state<SVGPatternElement>();
  let gridDot = $state<SVGCircleElement>();
  let textEditor = $state<HTMLTextAreaElement>();
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
  let startDescendantNodes = new Map<string, DesignNode>();
  let dragSourceNodes = new Map<string, DesignNode>();
  let dragDuplicated = false;
  let moveStarted = false;
  let startViewport = { x: 0, y: 0 };
  let moveFrame = 0;
  let wheelFrame = 0;
  let pendingWheelPan = { x: 0, y: 0 };
  let pendingWheelZoom = 1;
  let pendingWheelPoint: Point = { x: 0, y: 0 };
  let viewportCommitTimer: ReturnType<typeof setTimeout> | undefined;
  let gestureStartZoom = 1;
  let activePointerId: number | null = null;
  let activeGestureVersion = 0;
  let marqueeBaseSelection: string[] = [];
  let pendingClickSelection: string | null = null;
  let handledToolChangeToken = -1;
  let handledCancelInteractionToken = -1;
  let interactionSelectionKey = "";
  let interactionViewportKey = "";
  const dragThreshold = 4;

  // Keep high-frequency pan/zoom previews local to the canvas. Writing every
  // wheel frame into the document proxy makes all document consumers react,
  // including the recursive layer tree. The document is updated once the
  // gesture settles instead.
  const viewport = $state({ x: 0, y: 0, zoom: 1 });
  // This non-reactive copy is the source of truth while a pan or zoom is in
  // flight. It lets the animation frame touch only compositor-facing DOM
  // properties instead of scheduling a Svelte update for the whole canvas.
  const liveViewport = { x: 0, y: 0, zoom: 1 };
  let observedViewportKey = `${viewport.x}:${viewport.y}:${viewport.zoom}`;
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
  const editingView = $derived.by(() => {
    if (!editingNode) return null;
    const matrix = worldMatrix(session.document, editingNode);
    const origin = transformPoint(matrix, { x: 0, y: 0 });
    return { x: viewport.x + origin.x * viewport.zoom, y: viewport.y + origin.y * viewport.zoom, rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI };
  });
  const lineEndpoints = $derived.by(() => {
    if (session.selectedIds.length !== 1) return null;
    const node = session.document.nodes[session.selectedIds[0]];
    if (!node || (node.type !== "line" && node.type !== "arrow")) return null;
    const matrix = worldMatrix(session.document, node);
    return { start: transformPoint(matrix, { x: 0, y: 0 }), end: transformPoint(matrix, { x: node.width, y: node.height }) };
  });
  const orientedSelection = $derived.by(() => {
    if (session.selectedIds.length !== 1) return null;
    const node = session.document.nodes[session.selectedIds[0]];
    if (!node || node.type === "line" || node.type === "arrow") return null;
    const matrix = worldMatrix(session.document, node);
    const points = [
      transformPoint(matrix, { x: 0, y: 0 }),
      transformPoint(matrix, { x: node.width, y: 0 }),
      transformPoint(matrix, { x: node.width, y: node.height }),
      transformPoint(matrix, { x: 0, y: node.height }),
    ];
    const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const center = midpoint(points[0], points[2]);
    const top = midpoint(points[0], points[1]);
    const distance = Math.max(.0001, Math.hypot(top.x - center.x, top.y - center.y));
    const rotate = { x: top.x + (top.x - center.x) / distance * (26 / viewport.zoom), y: top.y + (top.y - center.y) / distance * (26 / viewport.zoom) };
    return {
      outline: points.map((point) => `${point.x},${point.y}`).join(" "), top, rotate,
      handles: [
        ["nw", points[0].x, points[0].y], ["n", top.x, top.y], ["ne", points[1].x, points[1].y],
        ["e", midpoint(points[1], points[2]).x, midpoint(points[1], points[2]).y], ["se", points[2].x, points[2].y],
        ["s", midpoint(points[2], points[3]).x, midpoint(points[2], points[3]).y], ["sw", points[3].x, points[3].y],
        ["w", midpoint(points[3], points[0]).x, midpoint(points[3], points[0]).y],
      ] as [string, number, number][],
    };
  });

  $effect(() => {
    const token = session.toolChangeToken;
    if (token === handledToolChangeToken) return;
    handledToolChangeToken = token;
    if (mode !== "idle") cancelInteraction();
    if (session.editingTextId) finishTextEditing(true);
  });

  $effect(() => {
    const token = session.cancelInteractionToken;
    if (token === handledCancelInteractionToken) return;
    handledCancelInteractionToken = token;
    if (mode !== "idle") cancelInteraction();
  });

  // Toolbar actions, fit-to-selection, undo, and page changes still update the
  // document viewport directly. Mirror those less frequent external changes
  // back into the canvas-local preview without subscribing this effect to the
  // local viewport itself.
  $effect(() => {
    const source = session.document.viewport;
    const x = source.x;
    const y = source.y;
    const zoom = source.zoom;
    const key = `${x}:${y}:${zoom}`;
    if (key === observedViewportKey) return;
    observedViewportKey = key;
    if (viewportCommitTimer) {
      clearTimeout(viewportCommitTimer);
      viewportCommitTimer = undefined;
    }
    viewport.x = x;
    viewport.y = y;
    viewport.zoom = zoom;
    liveViewport.x = x;
    liveViewport.y = y;
    liveViewport.zoom = zoom;
    queueMicrotask(applyViewportPreview);
  });

  $effect(() => {
    const key = session.selectedIds.join("\u0000");
    if (!["move", "resize", "rotate"].includes(mode) || key === interactionSelectionKey) return;
    queueMicrotask(() => mode !== "idle" && cancelInteraction());
  });

  $effect(() => {
    const key = `${viewport.x}:${viewport.y}:${viewport.zoom}`;
    if (mode === "idle" || mode === "pan" || key === interactionViewportKey) return;
    queueMicrotask(() => mode !== "idle" && mode !== "pan" && cancelInteraction());
  });

  $effect(() => {
    const version = session.gestureVersion;
    if (mode !== "draw" && mode !== "move" && mode !== "resize" && mode !== "rotate") return;
    if (version !== activeGestureVersion) queueMicrotask(() => mode !== "idle" && cancelInteraction());
  });

  onMount(() => {
    if (!session.document.rootIds.length && host) {
      liveViewport.x = host.clientWidth / 2;
      liveViewport.y = host.clientHeight / 2;
      persistViewport(false);
    }
    applyViewportPreview();
    const target = host;
    if (!target) return;
    const startGesture = (event: Event) => {
      event.preventDefault();
      if (mode !== "idle") cancelInteraction();
      gestureStartZoom = liveViewport.zoom;
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
              if (mode !== "idle") cancelInteraction();
              gestureStartZoom = liveViewport.zoom;
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
      cancelAnimationFrame(wheelFrame);
      if (mode !== "idle") cancelInteraction();
      if (viewportCommitTimer) {
        clearTimeout(viewportCommitTimer);
        viewportCommitTimer = undefined;
        persistViewport();
      }
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
    return screenToWorld(pointFromEvent(event), liveViewport);
  }

  function capturePointer(event: PointerEvent) {
    activePointerId = event.pointerId;
    session.persistencePaused = true;
    interactionViewportKey = `${liveViewport.x}:${liveViewport.y}:${liveViewport.zoom}`;
    try { host?.setPointerCapture(event.pointerId); } catch { /* the pointer may already have ended */ }
  }

  function releasePointer() {
    const pointerId = activePointerId;
    activePointerId = null;
    session.persistencePaused = false;
    if (pointerId === null) return;
    try { host?.releasePointerCapture(pointerId); } catch { /* capture may already be lost */ }
  }

  function resetInteractionState() {
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    marquee = null;
    draftId = null;
    draftParentId = null;
    pendingTextEditId = null;
    pendingClickSelection = null;
    dragDuplicated = false;
    moveStarted = false;
    session.guides = { x: null, y: null };
    mode = "idle";
    releasePointer();
  }

  function cancelInteraction() {
    if (mode === "pan") {
      liveViewport.x = startViewport.x;
      liveViewport.y = startViewport.y;
      applyViewportPreview();
    }
    if (session.hasActiveGesture) session.cancelGesture();
    resetInteractionState();
  }

  function begin(event: PointerEvent, hitId: string | null = null) {
    if (event.button === 2) return;
    if (activePointerId !== null && activePointerId !== event.pointerId) cancelInteraction();
    if (session.editingTextId) finishTextEditing();
    startScreen = pointFromEvent(event);
    startWorld = worldFromEvent(event);
    lastWorld = startWorld;

    if (event.button === 1 || session.activeTool === "hand" || spacePressed) {
      mode = "pan";
      startViewport = { x: liveViewport.x, y: liveViewport.y };
      capturePointer(event);
      return;
    }

    if (session.activeTool === "select") {
      marqueeBaseSelection = [...session.selectedIds];
      if (!event.shiftKey && !event.altKey) session.select(null);
      mode = "marquee";
      marquee = { x: startWorld.x, y: startWorld.y, width: 0, height: 0 };
      capturePointer(event);
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
      capturePointer(event);
      return;
    }
    // Drawing tools start as a zero-sized draft. The pointer gesture, not a
    // fallback click size, is the source of truth for the final geometry.
    node.width = 0;
    node.height = 0;
    session.beginGesture();
    activeGestureVersion = session.gestureVersion;
    node.parentId = draftParentId;
    session.document.nodes[node.id] = node;
    const parent = draftParentId ? session.document.nodes[draftParentId] : null;
    if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(node.id);
    else session.document.rootIds.push(node.id);
    session.selectedIds = [node.id];
    draftId = node.id;
    mode = "draw";
    capturePointer(event);
  }

  async function importImage(point: Point, parentId: string | null = draftParentId) {
    const asset = await import("$lib/repository").then(({ repository }) => repository().importImage());
    if (!asset) { session.setActiveTool("select", false); return; }
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

  function hitStackAt(event: PointerEvent): string[] {
    if (typeof document.elementsFromPoint !== "function") return [];
    return [...new Set(document.elementsFromPoint(event.clientX, event.clientY).flatMap((element) => {
      const owner = element.closest<SVGGElement>("[data-node-id]");
      const candidate = owner?.dataset.nodeId;
      return candidate && session.document.nodes[candidate] ? [candidate] : [];
    }))];
  }

  function isAncestorOf(ancestorId: string, descendantId: string): boolean {
    let parentId = session.document.nodes[descendantId]?.parentId ?? null;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = session.document.nodes[parentId]?.parentId ?? null;
    }
    return false;
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
    const deepSelect = event.metaKey || event.ctrlKey;
    const stack = hitStackAt(event);
    let targetId: string | null;
    if (deepSelect) {
      const deepStack = [...new Set(stack.map((candidate) => canvasSelectionTarget(session.document, candidate, [], true)).filter((candidate): candidate is string => Boolean(candidate)))];
      const current = deepStack.findIndex((candidate) => session.selectedIds.includes(candidate));
      targetId = deepStack.length ? deepStack[(current + 1 + deepStack.length) % deepStack.length] : canvasSelectionTarget(session.document, id, [], true);
    } else {
      // Shift-click operates on the outer selection boundary; an ordinary
      // repeated click uses the current selection as its drill-in scope. The
      // resolver skips structural frames while preserving groups as atomic
      // targets. Once a child establishes a scope, Shift can add its siblings.
      const selectedAncestorOfHit = session.selectedIds.length === 1 && isAncestorOf(session.selectedIds[0], id);
      const selectionContext = event.shiftKey && selectedAncestorOfHit ? [] : session.selectedIds;
      targetId = canvasSelectionTarget(session.document, id, selectionContext);
      if (!targetId) {
        for (const candidate of stack) {
          targetId = canvasSelectionTarget(session.document, candidate, selectionContext);
          if (targetId) break;
        }
      }
    }
    // A locked surface with nothing selectable beneath it behaves like empty
    // canvas. This is what makes marquee selection possible inside a locked
    // frame while its unlocked children remain interactive.
    if (!targetId) {
      begin(event);
      return;
    }
    const targetNode = session.document.nodes[targetId];
    if (!targetNode || targetNode.locked) {
      begin(event);
      return;
    }
    startScreen = pointFromEvent(event);
    startWorld = worldFromEvent(event);
    lastWorld = startWorld;
    const doublePress = lastNodePress.id === targetId && event.timeStamp - lastNodePress.at < 500;
    lastNodePress = doublePress ? { id: "", at: -Infinity } : { id: targetId, at: event.timeStamp };
    if (targetNode.type === "text" && (event.detail >= 2 || doublePress)) {
      pendingTextEditId = targetId;
      mode = "edit-text";
      capturePointer(event);
      return;
    }
    pendingClickSelection = null;
    let interactionId = targetId;
    const selectedAncestorId = !deepSelect && !event.shiftKey && session.selectedIds.length === 1
      && !session.document.nodes[session.selectedIds[0]]?.locked
      && isAncestorOf(session.selectedIds[0], targetId) ? session.selectedIds[0] : null;
    if (selectedAncestorId) {
      // A click drills into the child, but a drag that starts on that same
      // child continues to move the already-selected frame/group.
      pendingClickSelection = targetId;
      interactionId = selectedAncestorId;
    } else if (event.shiftKey) session.select(targetId, true);
    else if (session.selectedIds.includes(targetId) && session.selectedIds.length > 1) pendingClickSelection = targetId;
    else session.select(targetId);
    if (!session.selectedIds.includes(interactionId)) return;
    session.beginGesture();
    activeGestureVersion = session.gestureVersion;
    startNodes = new Map(session.selectedIds.map((selectedId) => [selectedId, JSON.parse(JSON.stringify(session.document.nodes[selectedId])) as DesignNode]));
    startNodeBounds = new Map([...startNodes].map(([id, node]) => [id, worldBounds(session.document, node)]));
    dragSourceNodes = new Map(startNodes);
    startBounds = selectionBounds(session.document, session.selectedIds);
    interactionSelectionKey = session.selectedIds.join("\u0000");
    dragDuplicated = false;
    moveStarted = false;
    mode = "move";
    capturePointer(event);
  }

  function nodeDoubleClick(_event: MouseEvent, id: string) {
    const node = session.document.nodes[id];
    if (node?.type === "text" && !node.locked && isCanvasNodeVisible(session.document, id)) {
      session.select(id);
      session.editingTextId = id;
      createdTextId = null;
      session.beginGesture();
    }
  }

  function nodeContextMenu(event: MouseEvent, id: string) {
    const node = session.document.nodes[id];
    if (!node || node.locked) return;
    if (!session.selectedIds.includes(id)) session.select(id);
    onContextMenu(event, worldFromEvent(event), id);
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
    startDescendantNodes = new Map();
    const captureDescendants = (node: DesignNode) => {
      if (node.type !== "group") return;
      for (const childId of node.childIds) {
        const child = session.document.nodes[childId];
        if (!child) continue;
        startDescendantNodes.set(child.id, JSON.parse(JSON.stringify(child)) as DesignNode);
        captureDescendants(child);
      }
    };
    startNodes.forEach(captureDescendants);
    interactionSelectionKey = session.selectedIds.join("\u0000");
    handle = nextHandle;
    mode = nextHandle === "rotate" ? "rotate" : "resize";
    session.beginGesture();
    activeGestureVersion = session.gestureVersion;
    capturePointer(event);
  }

  function move(event: PointerEvent) {
    if (mode === "idle" || event.pointerId !== activePointerId) return;
    const screen = pointFromEvent(event);
    const world = worldFromEvent(event);
    lastWorld = world;
    cancelAnimationFrame(moveFrame);
    if (mode === "move" && !moveStarted) {
      if (Math.hypot(screen.x - startScreen.x, screen.y - startScreen.y) < dragThreshold) return;
      moveStarted = true;
    }
    const shiftKey = event.shiftKey;
    const altKey = event.altKey;
    moveFrame = requestAnimationFrame(() => applyPointerMove(screen, world, shiftKey, altKey));
  }

  function applyPointerMove(screen: Point, world: Point, constrained: boolean, fromCenter: boolean) {
    if (mode === "pan") {
      liveViewport.x = startViewport.x + screen.x - startScreen.x;
      liveViewport.y = startViewport.y + screen.y - startScreen.y;
      applyViewportPreview();
      return;
    }
    if (mode === "marquee") {
      marquee = normalizeRect(startWorld, world);
      return;
    }
    if (mode === "text" || mode === "edit-text") {
      return;
    }
    if (!session.hasActiveGesture) {
      cancelInteraction();
      return;
    }
    if (mode === "draw" && draftId) {
      const node = session.document.nodes[draftId];
      if (!node) return;
      const local = worldToNodeLocal(session.document, draftParentId, world);
      let width = local.x - draftStart.x;
      let height = local.y - draftStart.y;
      if (constrained && (node.type === "line" || node.type === "arrow")) {
        const length = Math.hypot(width, height);
        const angle = Math.round(Math.atan2(height, width) / (Math.PI / 4)) * (Math.PI / 4);
        width = Math.cos(angle) * length;
        height = Math.sin(angle) * length;
      } else if (constrained) {
        const size = Math.max(Math.abs(width), Math.abs(height));
        width = Math.sign(width || 1) * size;
        height = Math.sign(height || 1) * size;
      }
      if (node.type === "line" || node.type === "arrow") {
        node.x = draftStart.x;
        node.y = draftStart.y;
        node.width = width;
        node.height = height;
      } else {
        node.x = width < 0 ? local.x : draftStart.x;
        node.y = height < 0 ? local.y : draftStart.y;
        node.width = Math.abs(width);
        node.height = Math.abs(height);
      }
      session.previewGesture();
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
    interactionSelectionKey = session.selectedIds.join("\u0000");
    dragDuplicated = true;
  }

  function moveSelection(world: Point, constrain: boolean, duplicate: boolean) {
    if (duplicate && !dragDuplicated) duplicateDragSelection();
    let dx = world.x - startWorld.x;
    let dy = world.y - startWorld.y;
    if (constrain) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    session.guides = { x: null, y: null };
    if (startBounds) {
      const excludedIds = new Set(session.selectedIds);
      const excludeDescendants = (id: string) => {
        const node = session.document.nodes[id];
        if (node?.type !== "frame" && node?.type !== "group") return;
        for (const childId of node.childIds) {
          if (excludedIds.has(childId)) continue;
          excludedIds.add(childId);
          excludeDescendants(childId);
        }
      };
      session.selectedIds.forEach(excludeDescendants);
      const otherBounds = Object.values(session.document.nodes).filter((node) => !excludedIds.has(node.id) && node.visible).map((node) => worldBounds(session.document, node));
      const threshold = 5 / liveViewport.zoom;
      const xCandidates = otherBounds.flatMap((rect) => [rect.x, rect.x + rect.width / 2, rect.x + rect.width]);
      const yCandidates = otherBounds.flatMap((rect) => [rect.y, rect.y + rect.height / 2, rect.y + rect.height]);
      const nearest = (anchors: number[], candidates: number[], offset: number) => {
        let result = { distance: Infinity, delta: 0, guide: null as number | null };
        for (const anchor of anchors) for (const candidate of candidates) {
          const delta = candidate - (anchor + offset);
          if (Math.abs(delta) < result.distance) result = { distance: Math.abs(delta), delta, guide: candidate };
        }
        return result;
      };
      const nearestX = nearest([startBounds.x, startBounds.x + startBounds.width / 2, startBounds.x + startBounds.width], xCandidates, dx);
      const nearestY = nearest([startBounds.y, startBounds.y + startBounds.height / 2, startBounds.y + startBounds.height], yCandidates, dy);
      if (nearestX.guide !== null && nearestX.distance <= threshold) { dx += nearestX.delta; session.guides.x = nearestX.guide; }
      if (nearestY.guide !== null && nearestY.distance <= threshold) { dy += nearestY.delta; session.guides.y = nearestY.guide; }
    }
    for (const [id, original] of startNodes) {
      const node = session.document.nodes[id];
      if (!node || node.locked) continue;
      const localStart = worldToNodeLocal(session.document, original.parentId, startWorld);
      const localEnd = worldToNodeLocal(session.document, original.parentId, { x: startWorld.x + dx, y: startWorld.y + dy });
      node.x = original.x + localEnd.x - localStart.x;
      node.y = original.y + localEnd.y - localStart.y;
    }
    session.previewGesture();
  }

  function resizeSelection(world: Point, constrain: boolean, fromCenter: boolean) {
    if (handle === "line-start" || handle === "line-end") {
      resizeLineEndpoint(world, constrain);
      return;
    }
    if (startNodes.size === 1) {
      resizeSingleSelection(world, constrain, fromCenter);
      return;
    }
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
        node.textAutoResize = "height";
        syncTextSize(node);
      }
      if (original.type === "group") scaleGroupDescendants(original, sx, sy);
    }
    session.previewGesture();
  }

  function resizeSingleSelection(world: Point, constrain: boolean, fromCenter: boolean) {
    const entry = [...startNodes][0];
    if (!entry) return;
    const [id, original] = entry;
    if (original.type === "line" || original.type === "arrow") return;
    const node = session.document.nodes[id];
    if (!node || node.locked) return;
    const matrix = nodeMatrix(original);
    const u = { x: matrix.a, y: matrix.b };
    const v = { x: matrix.c, y: matrix.d };
    const pointer = worldToNodeLocal(session.document, original.parentId, world);
    const localPoint = (x: number, y: number) => transformPoint(matrix, { x, y });
    const center = localPoint(original.width / 2, original.height / 2);
    let width = original.width;
    let height = original.height;
    let topLeft: Point;

    if (fromCenter) {
      const delta = { x: pointer.x - center.x, y: pointer.y - center.y };
      if (handle.includes("e") || handle.includes("w")) width = Math.max(1, Math.abs(delta.x * u.x + delta.y * u.y) * 2);
      if (handle.includes("n") || handle.includes("s")) height = Math.max(1, Math.abs(delta.x * v.x + delta.y * v.y) * 2);
      if (constrain && handle.length === 2) {
        const ratio = original.width / Math.max(1, original.height);
        if (width / height > ratio) height = width / ratio; else width = height * ratio;
      }
      topLeft = { x: center.x - u.x * width / 2 - v.x * height / 2, y: center.y - u.y * width / 2 - v.y * height / 2 };
    } else {
      const anchorX = handle.includes("w") ? original.width : handle.includes("e") ? 0 : original.width / 2;
      const anchorY = handle.includes("n") ? original.height : handle.includes("s") ? 0 : original.height / 2;
      const anchor = localPoint(anchorX, anchorY);
      const delta = { x: pointer.x - anchor.x, y: pointer.y - anchor.y };
      if (handle.includes("e")) width = Math.max(1, delta.x * u.x + delta.y * u.y);
      if (handle.includes("w")) width = Math.max(1, -(delta.x * u.x + delta.y * u.y));
      if (handle.includes("s")) height = Math.max(1, delta.x * v.x + delta.y * v.y);
      if (handle.includes("n")) height = Math.max(1, -(delta.x * v.x + delta.y * v.y));
      if (constrain && handle.length === 2) {
        const ratio = original.width / Math.max(1, original.height);
        if (width / height > ratio) height = width / ratio; else width = height * ratio;
      }
      const nextAnchorX = handle.includes("w") ? width : handle.includes("e") ? 0 : width / 2;
      const nextAnchorY = handle.includes("n") ? height : handle.includes("s") ? 0 : height / 2;
      topLeft = { x: anchor.x - u.x * nextAnchorX - v.x * nextAnchorY, y: anchor.y - u.y * nextAnchorX - v.y * nextAnchorY };
    }
    node.width = width;
    node.height = height;
    const nextMatrix = { ...matrix, e: topLeft.x, f: topLeft.y };
    const rotation = Math.atan2(nextMatrix.b, nextMatrix.a);
    node.rotation = rotation * 180 / Math.PI;
    node.x = nextMatrix.e - width / 2 + Math.cos(rotation) * width / 2 - Math.sin(rotation) * height / 2;
    node.y = nextMatrix.f - height / 2 + Math.sin(rotation) * width / 2 + Math.cos(rotation) * height / 2;
    if (node.type === "text") {
      node.autoWidth = false;
      node.textAutoResize = "height";
      syncTextSize(node);
    }
    if (original.type === "group") scaleGroupDescendants(original, width / Math.max(1, original.width), height / Math.max(1, original.height));
    session.previewGesture();
  }

  function scaleGroupDescendants(originalGroup: DesignNode, sx: number, sy: number) {
    if (originalGroup.type !== "group") return;
    const scale = Math.sqrt(Math.abs(sx * sy));
    for (const source of startDescendantNodes.values()) {
      let parentId = source.parentId;
      let inside = false;
      while (parentId) {
        if (parentId === originalGroup.id) { inside = true; break; }
        parentId = startDescendantNodes.get(parentId)?.parentId ?? null;
      }
      if (!inside) continue;
      const child = session.document.nodes[source.id];
      if (!child) continue;
      child.x = source.x * sx;
      child.y = source.y * sy;
      child.width = source.width * sx;
      child.height = source.height * sy;
      if (child.type !== "line" && child.type !== "arrow") {
        child.width = Math.max(1, child.width);
        child.height = Math.max(1, child.height);
      }
      if (child.type === "text" && source.type === "text") {
        child.fontSize = Math.max(1, source.fontSize * scale);
        child.letterSpacing = source.letterSpacing * scale;
        child.autoWidth = false;
        child.textAutoResize = "none";
      }
    }
  }

  function resizeLineEndpoint(world: Point, constrain: boolean) {
    const entry = [...startNodes][0];
    if (!entry) return;
    const [id, original] = entry;
    if (original.type !== "line" && original.type !== "arrow") return;
    const node = session.document.nodes[id];
    if (!node || node.locked) return;
    const matrix = worldMatrix(session.document, original);
    const originalStart = transformPoint(matrix, { x: 0, y: 0 });
    const originalEnd = transformPoint(matrix, { x: original.width, y: original.height });
    const fixed = handle === "line-start" ? originalEnd : originalStart;
    let moving = world;
    if (constrain) {
      const length = Math.hypot(world.x - fixed.x, world.y - fixed.y);
      const angle = Math.round(Math.atan2(world.y - fixed.y, world.x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4);
      moving = { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
    }
    const start = worldToNodeLocal(session.document, original.parentId, handle === "line-start" ? moving : fixed);
    const end = worldToNodeLocal(session.document, original.parentId, handle === "line-start" ? fixed : moving);
    node.x = start.x;
    node.y = start.y;
    node.width = end.x - start.x;
    node.height = end.y - start.y;
    node.rotation = 0;
    session.previewGesture();
  }

  function rotateSelection(world: Point, snap: boolean) {
    if (!startBounds) return;
    const center = { x: startBounds.x + startBounds.width / 2, y: startBounds.y + startBounds.height / 2 };
    const startAngle = Math.atan2(startWorld.y - center.y, startWorld.x - center.x);
    const nextAngle = Math.atan2(world.y - center.y, world.x - center.x);
    let delta = ((nextAngle - startAngle) * 180) / Math.PI;
    if (snap) delta = Math.round(delta / 15) * 15;
    const radians = (delta * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    for (const [id, original] of startNodes) {
      const node = session.document.nodes[id];
      if (!node || node.locked) continue;
      const matrix = worldMatrix(session.document, original);
      const originalCenter = transformPoint(matrix, { x: original.width / 2, y: original.height / 2 });
      const offsetX = originalCenter.x - center.x;
      const offsetY = originalCenter.y - center.y;
      const nextCenter = { x: center.x + offsetX * cos - offsetY * sin, y: center.y + offsetX * sin + offsetY * cos };
      const localCenter = worldToNodeLocal(session.document, original.parentId, nextCenter);
      node.x = localCenter.x - original.width / 2;
      node.y = localCenter.y - original.height / 2;
      node.rotation = original.rotation + delta;
    }
    session.previewGesture();
  }

  function end(event: PointerEvent) {
    if (mode === "idle" || event.pointerId !== activePointerId) return;
    cancelAnimationFrame(moveFrame);
    const endScreen = pointFromEvent(event);
    const endWorld = worldFromEvent(event);
    const dragged = (mode === "move" && moveStarted) || Math.hypot(endScreen.x - startScreen.x, endScreen.y - startScreen.y) >= dragThreshold;
    // Flush the final pointer coordinate; a queued animation frame may not
    // have run before pointerup on quick drags.
    if ((mode !== "draw" && mode !== "move") || dragged) applyPointerMove(endScreen, endWorld, event.shiftKey, event.altKey);
    if (mode === "marquee" && marquee) {
      if (dragged) {
        const fullyContained = endScreen.x >= startScreen.x;
        const tolerance = 2 / liveViewport.zoom;
        const ids = Object.values(session.document.nodes).filter((node) => {
          if (!isCanvasNodeVisible(session.document, node.id) || node.locked) return false;
          const bounds = worldBounds(session.document, node);
          if ((node.type === "frame" || node.type === "group") && rectContainsPoint(bounds, startWorld)) return false;
          return fullyContained ? containsRect(marquee!, bounds, tolerance) : intersects(marquee!, bounds);
        }).map((node) => node.id);
        session.selectedIds = marqueeBaseSelection;
        session.setSelection(ids, event.altKey ? "subtract" : event.shiftKey ? "add" : "replace");
      } else if (!event.shiftKey && !event.altKey) {
        session.select(null);
      }
      marquee = null;
    }
    if (mode === "edit-text" && pendingTextEditId) {
      session.select(pendingTextEditId);
      session.editingTextId = pendingTextEditId;
      createdTextId = null;
      pendingTextEditId = null;
      session.beginGesture();
      activeGestureVersion = session.gestureVersion;
    } else if (mode === "text") {
      const localEnd = worldToNodeLocal(session.document, draftParentId, endWorld);
      const node = defaultNode("text", draftStart.x, draftStart.y, { text: "", width: 1 });
      if (node.type === "text" && dragged) {
        node.x = Math.min(draftStart.x, localEnd.x);
        node.y = Math.min(draftStart.y, localEnd.y);
        node.width = Math.max(1, Math.abs(localEnd.x - draftStart.x));
        node.height = Math.max(node.fontSize * node.lineHeight, Math.abs(localEnd.y - draftStart.y));
        node.autoWidth = false;
        node.textAutoResize = "height";
      }
      session.beginGesture();
      activeGestureVersion = session.gestureVersion;
      node.parentId = draftParentId;
      session.document.nodes[node.id] = node;
      const parent = draftParentId ? session.document.nodes[draftParentId] : null;
      if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(node.id);
      else session.document.rootIds.push(node.id);
      session.selectedIds = [node.id];
      session.setActiveTool("select", false);
      session.editingTextId = node.id;
      createdTextId = node.id;
      draftParentId = null;
    } else if (mode === "draw" && draftId) {
      if (!dragged) {
        session.cancelGesture();
        session.selectedIds = [];
      } else {
        session.setActiveTool("select", false);
        session.commitGesture();
      }
      draftId = null;
      draftParentId = null;
    } else if (mode === "move" || mode === "resize" || mode === "rotate") {
      if (mode === "move" && !dragged) {
        session.discardGesture();
        if (pendingClickSelection) session.select(pendingClickSelection);
      } else if (mode === "move" && !spacePressed) {
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
        session.commitGesture();
      } else {
        session.commitGesture();
      }
    } else if (mode === "pan") persistViewport();
    resetInteractionState();
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    if (mode !== "idle") cancelInteraction();
    if (event.ctrlKey || event.metaKey) {
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      pendingWheelPoint = pointFromEvent(event);
      pendingWheelZoom *= Math.exp(-delta * .002);
    } else {
      pendingWheelPan.x += event.deltaX;
      pendingWheelPan.y += event.deltaY;
    }
    if (!wheelFrame) wheelFrame = requestAnimationFrame(flushWheel);
  }

  function flushWheel() {
    wheelFrame = 0;
    if (pendingWheelZoom !== 1) {
      zoomAtPoint(pendingWheelPoint, liveViewport.zoom * pendingWheelZoom, false);
      pendingWheelZoom = 1;
    }
    if (pendingWheelPan.x || pendingWheelPan.y) {
      liveViewport.x -= pendingWheelPan.x;
      liveViewport.y -= pendingWheelPan.y;
      pendingWheelPan = { x: 0, y: 0 };
    }
    applyViewportPreview();
    scheduleViewportCommit();
  }

  function zoomAtPoint(point: Point, requestedZoom: number, commit = true) {
    const world = screenToWorld(point, liveViewport);
    const next = Math.min(8, Math.max(.05, requestedZoom));
    liveViewport.x = point.x - world.x * next;
    liveViewport.y = point.y - world.y * next;
    liveViewport.zoom = next;
    if (commit) {
      applyViewportPreview();
      scheduleViewportCommit();
    }
  }

  function viewportTransform(value: { x: number; y: number; zoom: number }) {
    return `translate3d(${value.x}px, ${value.y}px, 0) scale(${value.zoom})`;
  }

  function applyViewportPreview() {
    const transform = viewportTransform(liveViewport);
    if (viewportElement) viewportElement.style.transform = transform;
    const gridSize = 8 * liveViewport.zoom;
    if (gridPattern) {
      gridPattern.setAttribute("width", String(gridSize));
      gridPattern.setAttribute("height", String(gridSize));
      gridPattern.setAttribute("x", String(liveViewport.x % gridSize));
      gridPattern.setAttribute("y", String(liveViewport.y % gridSize));
    }
    if (gridDot) gridDot.setAttribute("opacity", liveViewport.zoom > .65 ? ".25" : "0");
    const node = editingNode;
    if (textEditor && node?.type === "text") {
      const matrix = worldMatrix(session.document, node);
      const origin = transformPoint(matrix, { x: 0, y: 0 });
      textEditor.style.left = `${liveViewport.x + origin.x * liveViewport.zoom}px`;
      textEditor.style.top = `${liveViewport.y + origin.y * liveViewport.zoom}px`;
      textEditor.style.width = `${Math.max(80, node.width * liveViewport.zoom)}px`;
      textEditor.style.height = `${Math.max(30, node.height * liveViewport.zoom)}px`;
      textEditor.style.fontSize = `${node.fontSize * liveViewport.zoom}px`;
      textEditor.style.letterSpacing = `${node.letterSpacing * liveViewport.zoom}px`;
    }
  }

  function scheduleViewportCommit() {
    if (viewportCommitTimer) clearTimeout(viewportCommitTimer);
    viewportCommitTimer = setTimeout(() => {
      viewportCommitTimer = undefined;
      persistViewport();
    }, 220);
  }

  function persistViewport(markChanged = true) {
    const source = session.document.viewport;
    viewport.x = liveViewport.x;
    viewport.y = liveViewport.y;
    viewport.zoom = liveViewport.zoom;
    const key = `${liveViewport.x}:${liveViewport.y}:${liveViewport.zoom}`;
    observedViewportKey = key;
    source.x = liveViewport.x;
    source.y = liveViewport.y;
    source.zoom = liveViewport.zoom;
    if (markChanged) session.viewportChanged();
  }

  function contextMenu(event: MouseEvent) {
    event.preventDefault();
    session.select(null);
    onContextMenu(event, worldFromEvent(event));
  }

  function preventNativeCanvasGesture(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest(".text-editor")) return;
    event.preventDefault();
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

  function finishTextEditing(preserveTool = false) {
    const id = session.editingTextId;
    if (!id) return;
    const removeEmpty = createdTextId === id && session.document.nodes[id]?.type === "text" && !(session.document.nodes[id] as TextNode).text.length;
    session.editingTextId = null;
    createdTextId = null;
    if (removeEmpty) {
      session.cancelGesture();
      session.selectedIds = [];
    } else session.commitGesture();
    if (!preserveTool) session.setActiveTool("select", false);
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
    if (event.key === "Escape") {
      if (session.editingTextId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishTextEditing();
        return;
      }
      if (mode !== "idle") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelInteraction();
        return;
      }
    }
    if (event.code === "Space" && !event.repeat && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      spacePressed = true;
      event.preventDefault();
    }
  }

  function windowBlur() {
    spacePressed = false;
    if (mode !== "idle") cancelInteraction();
    else if (session.editingTextId) finishTextEditing();
  }

  function focus(node: HTMLTextAreaElement) {
    queueMicrotask(() => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }
</script>

<svelte:window onpointermove={move} onpointerup={end} onpointercancel={() => mode !== "idle" && cancelInteraction()} onkeydown={keyDown} onkeyup={(event) => event.code === "Space" && (spacePressed = false)} onblur={windowBlur} onpagehide={() => mode !== "idle" && cancelInteraction()} />

<div id="design-canvas" role="application" aria-label="Design canvas" data-mode={mode} data-gesture={session.hasActiveGesture ? "active" : "none"} class:grabbing={mode === "pan"} class:grab={session.activeTool === "hand" || spacePressed} class:crosshair={!['select', 'hand'].includes(session.activeTool)} class="canvas-host" bind:this={host} onpointerdown={begin} onwheel={wheel} oncontextmenu={contextMenu} onselectstart={preventNativeCanvasGesture} ondragstart={preventNativeCanvasGesture} onlostpointercapture={(event) => event.pointerId === activePointerId && mode !== "idle" && queueMicrotask(cancelInteraction)}>
  <svg class="canvas-background" width="100%" height="100%" aria-hidden="true">
    <defs>
      <pattern bind:this={gridPattern} id="grid" width={8 * viewport.zoom} height={8 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x % (8 * viewport.zoom)} y={viewport.y % (8 * viewport.zoom)}>
        <circle bind:this={gridDot} cx=".5" cy=".5" r=".5" fill="#797979" opacity={viewport.zoom > .65 ? .25 : 0} />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#626262" />
    <rect width="100%" height="100%" fill="url(#grid)" />
  </svg>

  <svg bind:this={viewportElement} class="viewport-layer" width="100%" height="100%" aria-label="Design canvas" style:transform={viewportTransform(viewport)}>
    <g class="world">
      {#each session.document.rootIds as id}
        {#if session.document.nodes[id]}
          <CanvasNode node={session.document.nodes[id]} document={session.document} selectedIds={session.selectedIds} imageSources={session.imageSources} {unclippedFrameIds} onNodePointerDown={nodePointerDown} onNodeDoubleClick={nodeDoubleClick} onNodeContextMenu={nodeContextMenu} />
        {/if}
      {/each}
    </g>

    <g class="world-overlay">
      {#if session.guides.x !== null}<line class="guide" x1={session.guides.x} y1={-100000} x2={session.guides.x} y2={100000} stroke-width={1 / viewport.zoom} />{/if}
      {#if session.guides.y !== null}<line class="guide" x1={-100000} y1={session.guides.y} x2={100000} y2={session.guides.y} stroke-width={1 / viewport.zoom} />{/if}

      {#if selectedBounds && !session.editingTextId}
        {@const size = 8 / viewport.zoom}
        <g class="selection-ui">
          {#if orientedSelection}<polygon points={orientedSelection.outline} fill="none" stroke="#0d99ff" stroke-width={1 / viewport.zoom} />{:else}<rect x={selectedBounds.x} y={selectedBounds.y} width={Math.max(selectedBounds.width, 1 / viewport.zoom)} height={Math.max(selectedBounds.height, 1 / viewport.zoom)} fill="none" stroke="#0d99ff" stroke-width={1 / viewport.zoom} />{/if}
          {#if lineEndpoints}
            <circle role="button" aria-label="Resize line start" tabindex="-1" class="line-handle" cx={lineEndpoints.start.x} cy={lineEndpoints.start.y} r={5 / viewport.zoom} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, "line-start")} />
            <circle role="button" aria-label="Resize line end" tabindex="-1" class="line-handle" cx={lineEndpoints.end.x} cy={lineEndpoints.end.y} r={5 / viewport.zoom} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, "line-end")} />
          {:else}
            {@const rotationTop = orientedSelection?.top ?? { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y }}
            {@const rotationPoint = orientedSelection?.rotate ?? { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y - 26 / viewport.zoom }}
            {@const transformHandles = orientedSelection?.handles ?? [
              ["nw", selectedBounds.x, selectedBounds.y], ["n", selectedBounds.x + selectedBounds.width / 2, selectedBounds.y], ["ne", selectedBounds.x + selectedBounds.width, selectedBounds.y],
              ["e", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height / 2], ["se", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height],
              ["s", selectedBounds.x + selectedBounds.width / 2, selectedBounds.y + selectedBounds.height], ["sw", selectedBounds.x, selectedBounds.y + selectedBounds.height], ["w", selectedBounds.x, selectedBounds.y + selectedBounds.height / 2],
            ]}
            <line x1={rotationTop.x} y1={rotationTop.y} x2={rotationPoint.x} y2={rotationPoint.y} stroke="#0d99ff" stroke-width={1 / viewport.zoom} />
            <circle role="button" aria-label="Rotate selection" tabindex="-1" cx={rotationPoint.x} cy={rotationPoint.y} r={4 / viewport.zoom} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, "rotate")} class="rotate-handle" />
            {#each transformHandles as item}
              <rect role="button" aria-label={`Resize ${item[0]}`} tabindex="-1" class={`handle handle-${item[0]}`} x={Number(item[1]) - size / 2} y={Number(item[2]) - size / 2} width={size} height={size} fill="white" stroke="#0d99ff" stroke-width={1 / viewport.zoom} onpointerdown={(event) => startHandle(event, String(item[0]))} />
            {/each}
          {/if}
          {#if session.selectedIds.length === 1}
            <g transform={`translate(${selectedBounds.x + selectedBounds.width / 2} ${selectedBounds.y + selectedBounds.height + 8 / viewport.zoom}) scale(${1 / viewport.zoom})`}>
              <rect x="-28" width="56" height="17" rx="3" fill="#0d99ff" /><text y="12" text-anchor="middle" fill="white" font-size="9">{Math.round(selectedBounds.width)} × {Math.round(selectedBounds.height)}</text>
            </g>
          {/if}
        </g>
      {/if}
      {#if marquee}<rect class="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="#0d99ff18" stroke="#0d99ff" stroke-width={1 / viewport.zoom} />{/if}
    </g>
  </svg>

  {#if editingNode?.type === "text" && editingBounds && editingView}
    <textarea
      bind:this={textEditor}
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
      style:left={`${editingView.x}px`}
      style:top={`${editingView.y}px`}
      style:width={`${Math.max(80, editingNode.width * viewport.zoom)}px`}
      style:height={`${Math.max(30, editingNode.height * viewport.zoom)}px`}
      style:transform={`rotate(${editingView.rotation}deg)`}
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
  .canvas-host { position: absolute; inset: 0; overflow: hidden; cursor: default; touch-action: none; user-select: none; -webkit-user-select: none; }.canvas-host :global(svg),.canvas-host :global(text),.canvas-host :global(image) { user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }.canvas-host.grab,.canvas-host.grab :global([data-node-id]) { cursor: grab !important; }.canvas-host.grabbing,.canvas-host.grabbing :global([data-node-id]) { cursor: grabbing !important; }.canvas-host.crosshair,.canvas-host.crosshair :global([data-node-id]) { cursor: crosshair !important; }
  svg { display: block; }.canvas-background,.viewport-layer { position: absolute; inset: 0; }.viewport-layer { overflow: visible; transform-origin: 0 0; will-change: transform; }.guide,.marquee { pointer-events: none; }.guide { stroke: #ff4ecd; vector-effect: non-scaling-stroke; }.selection-ui { pointer-events: none; user-select: none; -webkit-user-select: none; }.selection-ui .handle, .selection-ui .rotate-handle, .selection-ui .line-handle { pointer-events: all; }.handle-nw,.handle-se { cursor: nwse-resize; }.handle-ne,.handle-sw { cursor: nesw-resize; }.handle-n,.handle-s { cursor: ns-resize; }.handle-e,.handle-w { cursor: ew-resize; }.rotate-handle { cursor: grab; }.line-handle { cursor: crosshair; }
  .text-editor { position: absolute; z-index: 12; padding: 0; margin: 0; resize: none; overflow: hidden; border: 1px solid #0d99ff; outline: 0; background: transparent; caret-color: #0d99ff; white-space: pre; user-select: text; transform-origin: top left; }
</style>
