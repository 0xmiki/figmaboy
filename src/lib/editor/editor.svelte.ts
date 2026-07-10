import type { DesignFile, DesignNode, OpenedFile, PageDocument, PageMeta, Rect, Tool } from "$lib/domain";
import { cloneDocument, defaultNode, uid } from "$lib/domain";
import { identity, invert, multiply, selectionBounds, worldMatrix } from "$lib/geometry";
import { syncTextSize } from "$lib/text-layout";
import type { Matrix } from "$lib/geometry";

interface HistoryEntry {
  before: PageDocument;
  after: PageDocument;
}

interface ClipboardPayload {
  nodes: DesignNode[];
  rootIds: string[];
}

function childIds(node: DesignNode): string[] {
  return node.type === "frame" || node.type === "group" ? node.childIds : [];
}

function gatherSubtree(document: PageDocument, ids: string[]): DesignNode[] {
  const result: DesignNode[] = [];
  const visit = (id: string) => {
    const node = document.nodes[id];
    if (!node) return;
    result.push(JSON.parse(JSON.stringify(node)) as DesignNode);
    childIds(node).forEach(visit);
  };
  ids.forEach(visit);
  return result;
}

function removeFromParent(document: PageDocument, node: DesignNode): void {
  if (!node.parentId) {
    document.rootIds = document.rootIds.filter((id) => id !== node.id);
    return;
  }
  const parent = document.nodes[node.parentId];
  if (parent?.type === "frame" || parent?.type === "group") parent.childIds = parent.childIds.filter((id) => id !== node.id);
}

function applyLocalMatrix(node: DesignNode, matrix: Matrix): void {
  const rotation = Math.atan2(matrix.b, matrix.a);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centerX = node.width / 2;
  const centerY = node.height / 2;
  node.rotation = (rotation * 180) / Math.PI;
  node.x = matrix.e - centerX + cos * centerX - sin * centerY;
  node.y = matrix.f - centerY + sin * centerX + cos * centerY;
}

function normalizeTextSizes(document: PageDocument): void {
  for (const node of Object.values(document.nodes)) if (node.type === "text") syncTextSize(node);
}

export class EditorSession {
  file = $state<DesignFile>({} as DesignFile);
  pages = $state<PageMeta[]>([]);
  page = $state<PageMeta>({} as PageMeta);
  document = $state<PageDocument>({} as PageDocument);
  selectedIds = $state<string[]>([]);
  activeTool = $state<Tool>("select");
  leftTab = $state<"file" | "assets">("file");
  inspectorTab = $state<"design" | "prototype">("design");
  saveStatus = $state<"saved" | "dirty" | "saving" | "error" | "conflict">("saved");
  errorMessage = $state("");
  changeToken = $state(0);
  editingTextId = $state<string | null>(null);
  imageSources = $state<Record<string, string>>({});
  clipboard = $state<ClipboardPayload | null>(null);
  guides = $state<{ x: number | null; y: number | null }>({ x: null, y: null });

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private gestureBefore: PageDocument | null = null;

  constructor(opened: OpenedFile) {
    this.file = opened.file;
    this.pages = opened.pages;
    this.page = opened.page;
    this.document = opened.document;
    normalizeTextSizes(this.document);
  }

  get selectedNodes(): DesignNode[] {
    return this.selectedIds.map((id) => this.document.nodes[id]).filter(Boolean);
  }

  get bounds(): Rect | null {
    return selectionBounds(this.document, this.selectedIds);
  }

  snapshot(): PageDocument { return cloneDocument(this.document); }

  private changed(): void {
    this.changeToken += 1;
    this.saveStatus = "dirty";
  }

  mutate(mutator: (document: PageDocument) => void, record = true): void {
    const before = record ? this.snapshot() : null;
    mutator(this.document);
    if (record && before) {
      this.undoStack.push({ before, after: this.snapshot() });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.changed();
  }

  beginGesture(): void {
    if (!this.gestureBefore) this.gestureBefore = this.snapshot();
  }

  gestureChanged(): void { this.changed(); }

  commitGesture(): void {
    if (!this.gestureBefore) return;
    const after = this.snapshot();
    if (JSON.stringify(this.gestureBefore) !== JSON.stringify(after)) {
      this.undoStack.push({ before: this.gestureBefore, after });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.gestureBefore = null;
    this.changed();
  }

  cancelGesture(): void {
    if (!this.gestureBefore) return;
    this.document = this.gestureBefore;
    this.gestureBefore = null;
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.document = cloneDocument(entry.before);
    this.redoStack.push(entry);
    this.selectedIds = this.selectedIds.filter((id) => Boolean(this.document.nodes[id]));
    this.changed();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.document = cloneDocument(entry.after);
    this.undoStack.push(entry);
    this.selectedIds = this.selectedIds.filter((id) => Boolean(this.document.nodes[id]));
    this.changed();
  }

  select(id: string | null, additive = false): void {
    if (!id) { this.selectedIds = []; return; }
    const node = this.document.nodes[id];
    if (!node || node.locked) return;
    if (additive) this.selectedIds = this.selectedIds.includes(id) ? this.selectedIds.filter((item) => item !== id) : [...this.selectedIds, id];
    else this.selectedIds = [id];
  }

  addNode(node: DesignNode, parentId: string | null = null): void {
    node.parentId = parentId;
    this.mutate((document) => {
      document.nodes[node.id] = node;
      if (parentId) {
        const parent = document.nodes[parentId];
        if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(node.id);
        else document.rootIds.push(node.id);
      } else document.rootIds.push(node.id);
    });
    this.selectedIds = [node.id];
    this.activeTool = "select";
  }

  updateSelected(patch: Partial<DesignNode>): void {
    if (!this.selectedIds.length) return;
    this.mutate((document) => {
      this.selectedIds.forEach((id) => {
        const node = document.nodes[id];
        if (node && (!node.locked || "locked" in patch || "visible" in patch)) {
          Object.assign(node, patch);
          if (node.type === "text") syncTextSize(node);
        }
      });
    });
  }

  deleteSelection(): void {
    if (!this.selectedIds.length) return;
    this.mutate((document) => {
      const remove = (id: string) => {
        const node = document.nodes[id];
        if (!node || node.locked) return;
        childIds(node).forEach(remove);
        removeFromParent(document, node);
        delete document.nodes[id];
      };
      this.selectedIds.forEach(remove);
    });
    this.selectedIds = [];
  }

  copy(): void {
    if (!this.selectedIds.length) return;
    this.clipboard = { nodes: gatherSubtree(this.document, this.selectedIds), rootIds: [...this.selectedIds] };
    navigator.clipboard?.writeText(`FIGMABOY:${JSON.stringify(this.clipboard)}`).catch(() => undefined);
  }

  cut(): void { this.copy(); this.deleteSelection(); }

  async paste(at?: { x: number; y: number }): Promise<void> {
    let payload = this.clipboard;
    if (!payload) {
      try {
        const text = await navigator.clipboard?.readText();
        if (text?.startsWith("FIGMABOY:")) payload = JSON.parse(text.slice(10));
      } catch { /* clipboard permission is optional */ }
    }
    if (!payload) return;
    const map = new Map<string, string>();
    payload.nodes.forEach((node) => map.set(node.id, uid("node")));
    const rootSet = new Set(payload.rootIds);
    const roots = payload.nodes.filter((node) => rootSet.has(node.id));
    const bounds = roots.length ? {
      x: Math.min(...roots.map((node) => node.x)), y: Math.min(...roots.map((node) => node.y)),
      width: 0, height: 0,
    } : { x: 0, y: 0, width: 0, height: 0 };
    const offset = at ? { x: at.x - bounds.x, y: at.y - bounds.y } : { x: 24, y: 24 };
    const pastedRoots: string[] = [];
    this.mutate((document) => {
      payload!.nodes.forEach((source) => {
        const copy = JSON.parse(JSON.stringify(source)) as DesignNode;
        copy.id = map.get(source.id)!;
        copy.name = `${source.name} copy`;
        copy.parentId = source.parentId && map.has(source.parentId) ? map.get(source.parentId)! : null;
        if (rootSet.has(source.id)) { copy.x += offset.x; copy.y += offset.y; pastedRoots.push(copy.id); }
        if (copy.type === "frame" || copy.type === "group") copy.childIds = copy.childIds.map((id) => map.get(id)!).filter(Boolean);
        document.nodes[copy.id] = copy;
      });
      document.rootIds.push(...pastedRoots);
    });
    this.selectedIds = pastedRoots;
  }

  duplicateSelection(offset = { x: 24, y: 24 }, record = true): void {
    if (!this.selectedIds.length) return;
    const selected = new Set(this.selectedIds);
    const roots = this.selectedNodes.filter((node) => {
      let parentId = node.parentId;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = this.document.nodes[parentId]?.parentId ?? null;
      }
      return true;
    });
    if (!roots.length) return;

    const sources = gatherSubtree(this.document, roots.map((node) => node.id));
    const idMap = new Map(sources.map((node) => [node.id, uid("node")]));
    const nextSelection: string[] = [];
    this.mutate((document) => {
      for (const source of sources) {
        const copy = JSON.parse(JSON.stringify(source)) as DesignNode;
        copy.id = idMap.get(source.id)!;
        copy.name = `${source.name} copy`;
        copy.parentId = source.parentId && idMap.has(source.parentId) ? idMap.get(source.parentId)! : source.parentId;
        if (roots.some((root) => root.id === source.id)) {
          copy.x += offset.x;
          copy.y += offset.y;
          nextSelection.push(copy.id);
        }
        if (copy.type === "frame" || copy.type === "group") {
          copy.childIds = copy.childIds.map((id) => idMap.get(id) ?? id);
        }
        document.nodes[copy.id] = copy;
      }

      for (const root of roots) {
        const copyId = idMap.get(root.id)!;
        const siblings = root.parentId
          ? (document.nodes[root.parentId] as Extract<DesignNode, { type: "frame" | "group" }> | undefined)?.childIds
          : document.rootIds;
        if (!siblings) continue;
        const sourceIndex = siblings.indexOf(root.id);
        siblings.splice(sourceIndex < 0 ? siblings.length : sourceIndex + 1, 0, copyId);
      }
    }, record);
    this.selectedIds = nextSelection;
  }

  duplicate(): void { this.duplicateSelection(); }

  selectAll(): void {
    this.selectedIds = this.document.rootIds.filter((id) => {
      const node = this.document.nodes[id];
      return node?.visible && !node.locked;
    });
  }

  selectParent(): void {
    const parentId = this.selectedNodes[0]?.parentId;
    if (parentId) this.select(parentId);
  }

  selectFirstChild(): void {
    const node = this.selectedNodes[0];
    if (node && (node.type === "frame" || node.type === "group") && node.childIds[0]) this.select(node.childIds[0]);
  }

  reparentSelection(parentId: string | null, record = true): void {
    const selected = new Set(this.selectedIds);
    const roots = this.selectedNodes.filter((node) => {
      let ancestorId = node.parentId;
      while (ancestorId) {
        if (selected.has(ancestorId)) return false;
        ancestorId = this.document.nodes[ancestorId]?.parentId ?? null;
      }
      return true;
    });
    if (!roots.length || roots.every((node) => node.parentId === parentId)) return;

    let ancestorId = parentId;
    while (ancestorId) {
      if (roots.some((node) => node.id === ancestorId)) return;
      ancestorId = this.document.nodes[ancestorId]?.parentId ?? null;
    }

    const worldMatrices = new Map(roots.map((node) => [node.id, worldMatrix(this.document, node)]));
    const parentWorld = parentId && this.document.nodes[parentId]
      ? worldMatrix(this.document, this.document.nodes[parentId])
      : identity;

    this.mutate((document) => {
      for (const node of roots) {
        const matrix = worldMatrices.get(node.id);
        if (!matrix) continue;
        removeFromParent(document, node);
        node.parentId = parentId;
        applyLocalMatrix(node, multiply(invert(parentWorld), matrix));
        if (parentId) {
          const parent = document.nodes[parentId];
          if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(node.id);
          else document.rootIds.push(node.id);
        } else document.rootIds.push(node.id);
      }
    }, record);
  }

  groupSelection(asFrame = false): void {
    const nodes = this.selectedNodes.filter((node) => !node.locked);
    if (nodes.length < 1) return;
    const parentId = nodes.every((node) => node.parentId === nodes[0].parentId) ? nodes[0].parentId : null;
    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const right = Math.max(...nodes.map((node) => node.x + node.width));
    const bottom = Math.max(...nodes.map((node) => node.y + node.height));
    const container = defaultNode(asFrame ? "frame" : "group", left, top, {
      width: Math.max(1, right - left), height: Math.max(1, bottom - top), parentId,
      fill: asFrame ? { type: "solid", color: "#ffffff", opacity: 1 } : null,
      childIds: nodes.map((node) => node.id), clipContent: asFrame,
    } as Partial<DesignNode>);
    this.mutate((document) => {
      nodes.forEach((node) => {
        removeFromParent(document, node);
        node.parentId = container.id;
        node.x -= left;
        node.y -= top;
      });
      document.nodes[container.id] = container;
      if (parentId) {
        const parent = document.nodes[parentId];
        if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(container.id);
      } else document.rootIds.push(container.id);
    });
    this.selectedIds = [container.id];
  }

  ungroupSelection(): void {
    const containers = this.selectedNodes.filter((node): node is Extract<DesignNode, { type: "group" | "frame" }> => node.type === "group" || node.type === "frame");
    if (!containers.length) return;
    const nextSelection: string[] = [];
    this.mutate((document) => {
      containers.forEach((container) => {
        const parentId = container.parentId;
        removeFromParent(document, container);
        for (const id of container.childIds) {
          const child = document.nodes[id];
          if (!child) continue;
          child.x += container.x;
          child.y += container.y;
          child.parentId = parentId;
          nextSelection.push(id);
          if (parentId) {
            const parent = document.nodes[parentId];
            if (parent?.type === "frame" || parent?.type === "group") parent.childIds.push(id);
          } else document.rootIds.push(id);
        }
        delete document.nodes[container.id];
      });
    });
    this.selectedIds = nextSelection;
  }

  arrange(direction: "front" | "back" | "forward" | "backward"): void {
    this.mutate((document) => {
      for (const id of this.selectedIds) {
        const node = document.nodes[id];
        if (!node) continue;
        const list = node.parentId && (document.nodes[node.parentId]?.type === "frame" || document.nodes[node.parentId]?.type === "group")
          ? (document.nodes[node.parentId] as Extract<DesignNode, { type: "frame" | "group" }>).childIds : document.rootIds;
        const index = list.indexOf(id);
        if (index < 0) continue;
        list.splice(index, 1);
        if (direction === "front") list.push(id);
        else if (direction === "back") list.unshift(id);
        else list.splice(Math.max(0, Math.min(list.length, index + (direction === "forward" ? 1 : -1))), 0, id);
      }
    });
  }

  nudge(dx: number, dy: number): void {
    if (!this.selectedIds.length) return;
    this.mutate((document) => {
      this.selectedIds.forEach((id) => {
        const node = document.nodes[id];
        if (node && !node.locked) { node.x += dx; node.y += dy; }
      });
    });
  }

  setPage(page: PageMeta, document: PageDocument): void {
    this.page = page;
    this.document = document;
    normalizeTextSizes(this.document);
    this.selectedIds = [];
    this.undoStack = [];
    this.redoStack = [];
    this.saveStatus = "saved";
  }
}
