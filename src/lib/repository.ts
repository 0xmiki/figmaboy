import { invoke } from "@tauri-apps/api/core";
import type { DesignFile, ImportedAsset, LibrarySnapshot, OpenedFile, PageDocument, PageMeta, Project } from "$lib/domain";
import { emptyDocument, uid } from "$lib/domain";
import { sanitizeDocument } from "$lib/document-validation";
import type { ExtensionManifest, InstalledExtension } from "$lib/extensions/types";

export interface Repository {
  library(): Promise<LibrarySnapshot>;
  fileThumbnail(fileId: string): Promise<string | null>;
  createProject(name: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  trashProject(id: string): Promise<void>;
  createFile(projectId: string | null): Promise<OpenedFile>;
  openFile(id: string): Promise<OpenedFile>;
  renameFile(id: string, name: string): Promise<void>;
  starFile(id: string, starred: boolean): Promise<void>;
  moveFile(id: string, projectId: string | null): Promise<void>;
  duplicateFile(id: string): Promise<DesignFile>;
  trashFile(id: string): Promise<void>;
  restoreItem(kind: "project" | "file", id: string): Promise<void>;
  deleteItem(kind: "project" | "file", id: string): Promise<void>;
  savePage(pageId: string, expectedRevision: number, document: PageDocument, thumbnail?: string | null): Promise<number>;
  savePagePreview(pageId: string, thumbnail: string): Promise<void>;
  loadPage(pageId: string): Promise<{ page: PageMeta; document: PageDocument }>;
  createPage(fileId: string, name: string): Promise<{ page: PageMeta; document: PageDocument }>;
  renamePage(pageId: string, name: string): Promise<void>;
  duplicatePage(pageId: string): Promise<{ page: PageMeta; document: PageDocument }>;
  deletePage(pageId: string): Promise<void>;
  reorderPages(fileId: string, pageIds: string[]): Promise<void>;
  importImage(): Promise<ImportedAsset | null>;
  importImageData(dataBase64: string): Promise<ImportedAsset>;
  readAsset(id: string): Promise<string>;
  exportPackage(kind: "project" | "file", id: string): Promise<boolean>;
  importPackage(): Promise<boolean>;
  exportRender(name: string, extension: "svg" | "png", data: string): Promise<boolean>;
  extensionsList(): Promise<InstalledExtension[]>;
  extensionStage(manifest: ExtensionManifest): Promise<InstalledExtension>;
  extensionKeep(extensionId: string, hash: string): Promise<InstalledExtension>;
  extensionDiscard(extensionId: string, hash: string): Promise<InstalledExtension[]>;
  extensionSetEnabled(extensionId: string, enabled: boolean): Promise<InstalledExtension>;
  extensionRollback(extensionId: string, hash: string): Promise<InstalledExtension>;
  extensionRemove(extensionId: string): Promise<InstalledExtension[]>;
  extensionImport(): Promise<unknown | null>;
}

interface BrowserState extends LibrarySnapshot {
  pages: PageMeta[];
  documents: Record<string, PageDocument>;
  assets: Record<string, ImportedAsset>;
}

const STORAGE_KEY = "figmaboy.workspace.v1";
const STORAGE_BACKUP_KEY = "figmaboy.workspace.v1.backup";
const EXTENSIONS_STORAGE_KEY = "figmaboy.extensions.v1";
const now = () => new Date().toISOString();

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeBrowserState(value: unknown): { state: BrowserState; recovered: boolean } {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const objects = (candidate: unknown) => Array.isArray(candidate) ? candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const timestamp = now();
  const projects = objects(source.projects).filter((item) => typeof item.id === "string" && typeof item.name === "string").map((item) => ({
    ...item, id: item.id as string, name: item.name as string,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : timestamp,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : timestamp,
    trashedAt: typeof item.trashedAt === "string" ? item.trashedAt : null,
  })) as Project[];
  const projectIds = new Set(projects.map((project) => project.id));
  const files = objects(source.files).filter((item) => typeof item.id === "string" && typeof item.name === "string").map((item) => ({
    ...item, id: item.id as string, name: item.name as string,
    projectId: typeof item.projectId === "string" && projectIds.has(item.projectId) ? item.projectId : null,
    starred: item.starred === true,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : timestamp,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : timestamp,
    lastOpenedAt: typeof item.lastOpenedAt === "string" ? item.lastOpenedAt : null,
    trashedAt: typeof item.trashedAt === "string" ? item.trashedAt : null,
    thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null,
  })) as DesignFile[];
  const fileIds = new Set(files.map((file) => file.id));
  const pages = objects(source.pages).filter((item) => typeof item.id === "string" && typeof item.fileId === "string" && fileIds.has(item.fileId)).map((item) => ({
    ...item, id: item.id as string, fileId: item.fileId as string,
    name: typeof item.name === "string" ? item.name : "Recovered page",
    position: typeof item.position === "number" && Number.isFinite(item.position) ? Math.max(0, Math.floor(item.position)) : 0,
    revision: typeof item.revision === "number" && Number.isFinite(item.revision) ? Math.max(0, Math.floor(item.revision)) : 0,
  })) as PageMeta[];
  const rawDocuments = source.documents && typeof source.documents === "object" && !Array.isArray(source.documents) ? source.documents as Record<string, unknown> : {};
  const documents: Record<string, PageDocument> = {};
  for (const page of pages) documents[page.id] = sanitizeDocument(rawDocuments[page.id]).document;
  for (const file of files) {
    if (pages.some((page) => page.fileId === file.id)) continue;
    const page: PageMeta = { id: uid("page"), fileId: file.id, name: "Recovered page", position: 0, revision: 0 };
    pages.push(page);
    documents[page.id] = emptyDocument();
  }
  const rawAssets = source.assets && typeof source.assets === "object" && !Array.isArray(source.assets) ? source.assets as Record<string, unknown> : {};
  const assets = Object.fromEntries(Object.entries(rawAssets).flatMap(([id, item]) => {
    if (!item || typeof item !== "object") return [];
    const asset = item as Partial<ImportedAsset>;
    if (typeof asset.dataUrl !== "string" || !asset.dataUrl.startsWith("data:image/") || !["image/png", "image/jpeg", "image/webp"].includes(asset.mime ?? "")) return [];
    return [[id, { ...asset, id, width: Number.isFinite(asset.width) ? asset.width : 1, height: Number.isFinite(asset.height) ? asset.height : 1 } as ImportedAsset]];
  }));
  const state = { projects, files, pages, documents, assets };
  let recovered = true;
  try { recovered = JSON.stringify(value) !== JSON.stringify(state); } catch { /* malformed state is recovered */ }
  return { state, recovered };
}

function loadBrowserState(): BrowserState {
  for (const key of [STORAGE_KEY, STORAGE_BACKUP_KEY]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const normalized = normalizeBrowserState(JSON.parse(raw));
      if (key === STORAGE_BACKUP_KEY || normalized.recovered) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.state)); } catch { /* keep using recovered state in memory */ }
      }
      return normalized.state;
    } catch { /* try the backup */ }
  }
  return { projects: [], files: [], pages: [], documents: {}, assets: {} };
}

function persistBrowserState(state: BrowserState): void {
  const serialized = JSON.stringify(state);
  const previous = localStorage.getItem(STORAGE_KEY);
  if (previous) {
    try { localStorage.setItem(STORAGE_BACKUP_KEY, previous); } catch { /* a current save is more important than refreshing the backup */ }
  }
  localStorage.setItem(STORAGE_KEY, serialized);
}

interface BrowserExtensionState {
  records: InstalledExtension[];
  manifests: Record<string, ExtensionManifest>;
}

function loadBrowserExtensions(): BrowserExtensionState {
  try {
    const value = JSON.parse(localStorage.getItem(EXTENSIONS_STORAGE_KEY) ?? "{}");
    return {
      records: Array.isArray(value.records) ? value.records : [],
      manifests: value.manifests && typeof value.manifests === "object" && !Array.isArray(value.manifests) ? value.manifests : {},
    };
  } catch {
    return { records: [], manifests: {} };
  }
}

function persistBrowserExtensions(state: BrowserExtensionState): void {
  localStorage.setItem(EXTENSIONS_STORAGE_KEY, JSON.stringify(state));
}

async function manifestHash(manifest: ExtensionManifest): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(manifest));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

class BrowserRepository implements Repository {
  private state(): BrowserState { return loadBrowserState(); }

  async library(): Promise<LibrarySnapshot> {
    const { projects, files } = this.state();
    return { projects, files };
  }

  async fileThumbnail(fileId: string): Promise<string | null> {
    return this.state().files.find((file) => file.id === fileId)?.thumbnail ?? null;
  }

  async createProject(name: string): Promise<Project> {
    const state = this.state();
    const timestamp = now();
    const project: Project = { id: uid("project"), name, createdAt: timestamp, updatedAt: timestamp, trashedAt: null };
    state.projects.push(project);
    persistBrowserState(state);
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const state = this.state();
    const project = state.projects.find((item) => item.id === id);
    if (project) Object.assign(project, { name, updatedAt: now() });
    persistBrowserState(state);
  }

  async trashProject(id: string): Promise<void> {
    const state = this.state();
    const timestamp = now();
    const project = state.projects.find((item) => item.id === id);
    if (project) project.trashedAt = timestamp;
    state.files.filter((file) => file.projectId === id).forEach((file) => (file.trashedAt = timestamp));
    persistBrowserState(state);
  }

  async createFile(projectId: string | null): Promise<OpenedFile> {
    const state = this.state();
    const timestamp = now();
    const file: DesignFile = {
      id: uid("file"), projectId, name: "Untitled", starred: false, createdAt: timestamp, updatedAt: timestamp,
      lastOpenedAt: timestamp, trashedAt: null, thumbnail: null,
    };
    const page: PageMeta = { id: uid("page"), fileId: file.id, name: "Page 1", position: 0, revision: 0 };
    const document = emptyDocument();
    state.files.push(file);
    state.pages.push(page);
    state.documents[page.id] = document;
    persistBrowserState(state);
    return { file, pages: [page], page, document };
  }

  async openFile(id: string): Promise<OpenedFile> {
    const state = this.state();
    const file = state.files.find((item) => item.id === id && !item.trashedAt);
    if (!file) throw new Error("Design file not found");
    file.lastOpenedAt = now();
    const pages = state.pages.filter((page) => page.fileId === id).sort((a, b) => a.position - b.position);
    const page = pages[0];
    if (!page) throw new Error("Design file has no pages");
    persistBrowserState(state);
    return { file, pages, page, document: structuredClone(state.documents[page.id] ?? emptyDocument()) };
  }

  async renameFile(id: string, name: string): Promise<void> {
    const state = this.state();
    const file = state.files.find((item) => item.id === id);
    if (file) Object.assign(file, { name, updatedAt: now() });
    persistBrowserState(state);
  }

  async starFile(id: string, starred: boolean): Promise<void> {
    const state = this.state();
    const file = state.files.find((item) => item.id === id);
    if (file) file.starred = starred;
    persistBrowserState(state);
  }

  async moveFile(id: string, projectId: string | null): Promise<void> {
    const state = this.state();
    const file = state.files.find((item) => item.id === id);
    if (file) Object.assign(file, { projectId, updatedAt: now() });
    persistBrowserState(state);
  }

  async duplicateFile(id: string): Promise<DesignFile> {
    const state = this.state();
    const source = state.files.find((item) => item.id === id);
    if (!source) throw new Error("Design file not found");
    const timestamp = now();
    const copy: DesignFile = { ...source, id: uid("file"), name: `${source.name} copy`, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: null };
    state.files.push(copy);
    const sourcePages = state.pages.filter((page) => page.fileId === id).sort((a, b) => a.position - b.position);
    for (const sourcePage of sourcePages) {
      const page = { ...sourcePage, id: uid("page"), fileId: copy.id, revision: 0 };
      state.pages.push(page);
      state.documents[page.id] = structuredClone(state.documents[sourcePage.id]);
    }
    persistBrowserState(state);
    return copy;
  }

  async trashFile(id: string): Promise<void> {
    const state = this.state();
    const file = state.files.find((item) => item.id === id);
    if (file) file.trashedAt = now();
    persistBrowserState(state);
  }

  async restoreItem(kind: "project" | "file", id: string): Promise<void> {
    const state = this.state();
    if (kind === "project") {
      const project = state.projects.find((item) => item.id === id);
      if (project) project.trashedAt = null;
      state.files.filter((file) => file.projectId === id).forEach((file) => (file.trashedAt = null));
    } else {
      const file = state.files.find((item) => item.id === id);
      if (file) {
        file.trashedAt = null;
        if (file.projectId && state.projects.find((project) => project.id === file.projectId)?.trashedAt) file.projectId = null;
      }
    }
    persistBrowserState(state);
  }

  async deleteItem(kind: "project" | "file", id: string): Promise<void> {
    const state = this.state();
    const fileIds = kind === "project" ? state.files.filter((file) => file.projectId === id).map((file) => file.id) : [id];
    const pageIds = state.pages.filter((page) => fileIds.includes(page.fileId)).map((page) => page.id);
    state.files = state.files.filter((file) => !fileIds.includes(file.id));
    state.pages = state.pages.filter((page) => !pageIds.includes(page.id));
    pageIds.forEach((pageId) => delete state.documents[pageId]);
    if (kind === "project") state.projects = state.projects.filter((project) => project.id !== id);
    persistBrowserState(state);
  }

  async savePage(pageId: string, expectedRevision: number, document: PageDocument, thumbnail?: string | null): Promise<number> {
    const state = this.state();
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) throw new Error("Page not found");
    if (page.revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
    page.revision += 1;
    state.documents[pageId] = structuredClone(document);
    const file = state.files.find((item) => item.id === page.fileId);
    if (file) { file.updatedAt = now(); if (thumbnail !== undefined) file.thumbnail = thumbnail; }
    persistBrowserState(state);
    return page.revision;
  }

  async savePagePreview(pageId: string, thumbnail: string): Promise<void> {
    const state = this.state();
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) return;
    const file = state.files.find((item) => item.id === page.fileId);
    if (file) file.thumbnail = thumbnail;
    persistBrowserState(state);
  }

  async loadPage(pageId: string): Promise<{ page: PageMeta; document: PageDocument }> {
    const state = this.state();
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) throw new Error("Page not found");
    return { page, document: structuredClone(state.documents[pageId] ?? emptyDocument()) };
  }

  async createPage(fileId: string, name: string): Promise<{ page: PageMeta; document: PageDocument }> {
    const state = this.state();
    const position = state.pages.filter((page) => page.fileId === fileId).length;
    const page: PageMeta = { id: uid("page"), fileId, name, position, revision: 0 };
    const document = emptyDocument();
    state.pages.push(page);
    state.documents[page.id] = document;
    persistBrowserState(state);
    return { page, document };
  }

  async renamePage(pageId: string, name: string): Promise<void> {
    const state = this.state();
    const page = state.pages.find((item) => item.id === pageId);
    if (page) page.name = name;
    persistBrowserState(state);
  }

  async duplicatePage(pageId: string): Promise<{ page: PageMeta; document: PageDocument }> {
    const state = this.state();
    const source = state.pages.find((item) => item.id === pageId);
    if (!source) throw new Error("Page not found");
    const page: PageMeta = { ...source, id: uid("page"), name: `${source.name} copy`, position: state.pages.filter((item) => item.fileId === source.fileId).length, revision: 0 };
    const document = structuredClone(state.documents[pageId]);
    state.pages.push(page);
    state.documents[page.id] = document;
    persistBrowserState(state);
    return { page, document };
  }

  async deletePage(pageId: string): Promise<void> {
    const state = this.state();
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) return;
    if (state.pages.filter((item) => item.fileId === page.fileId).length <= 1) throw new Error("A design file needs at least one page");
    state.pages = state.pages.filter((item) => item.id !== pageId);
    delete state.documents[pageId];
    state.pages.filter((item) => item.fileId === page.fileId).sort((a, b) => a.position - b.position).forEach((item, index) => (item.position = index));
    persistBrowserState(state);
  }

  async reorderPages(fileId: string, pageIds: string[]): Promise<void> {
    const state = this.state();
    pageIds.forEach((id, position) => {
      const page = state.pages.find((item) => item.fileId === fileId && item.id === id);
      if (page) page.position = position;
    });
    persistBrowserState(state);
  }

  async importImage(): Promise<ImportedAsset | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          const image = new Image();
          image.onload = () => {
            const state = this.state();
            const asset: ImportedAsset = { id: uid("asset"), mime: file.type as ImportedAsset["mime"], dataUrl: String(reader.result), width: image.naturalWidth, height: image.naturalHeight };
            state.assets[asset.id] = asset;
            persistBrowserState(state);
            resolve(asset);
          };
          image.onerror = () => resolve(null);
          image.src = String(reader.result);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  async importImageData(dataBase64: string): Promise<ImportedAsset> {
    if (dataBase64.length > 70 * 1024 * 1024) throw new Error("Images must be smaller than 50 MB");
    const mime: ImportedAsset["mime"] | null = dataBase64.startsWith("iVBOR") ? "image/png"
      : dataBase64.startsWith("/9j/") ? "image/jpeg"
      : dataBase64.startsWith("UklGR") ? "image/webp" : null;
    if (!mime) throw new Error("Choose a PNG, JPEG, or WebP image");
    const dataUrl = `data:${mime};base64,${dataBase64}`;
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The generated image is damaged"));
    });
    image.src = dataUrl;
    await loaded;
    const state = this.state();
    const asset: ImportedAsset = { id: uid("asset"), mime, dataUrl, width: image.naturalWidth, height: image.naturalHeight };
    state.assets[asset.id] = asset;
    persistBrowserState(state);
    return asset;
  }

  async readAsset(id: string): Promise<string> {
    const asset = this.state().assets[id];
    if (!asset) throw new Error("Asset not found");
    return asset.dataUrl;
  }

  async exportPackage(kind: "project" | "file", id: string): Promise<boolean> {
    const state = this.state();
    const fileIds = kind === "project" ? state.files.filter((file) => file.projectId === id).map((file) => file.id) : [id];
    const payload = {
      manifest: { format: "figmaboy", schemaVersion: 1, kind, exportedAt: now() },
      projects: kind === "project" ? state.projects.filter((project) => project.id === id) : [],
      files: state.files.filter((file) => fileIds.includes(file.id)),
      pages: state.pages.filter((page) => fileIds.includes(page.fileId)),
      documents: Object.fromEntries(Object.entries(state.documents).filter(([pageId]) => state.pages.some((page) => page.id === pageId && fileIds.includes(page.fileId)))),
      assets: state.assets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kind === "project" ? "project" : "design"}.figmaboy`;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async importPackage(): Promise<boolean> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".figmaboy,application/json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(false);
        try {
          const payload = JSON.parse(await file.text()) as Record<string, unknown>;
          const manifest = payload.manifest && typeof payload.manifest === "object" ? payload.manifest as Record<string, unknown> : null;
          if (manifest?.format !== "figmaboy" || manifest.schemaVersion !== 1) return resolve(false);
          if (!Array.isArray(payload.files) || !Array.isArray(payload.pages) || !payload.documents || typeof payload.documents !== "object") return resolve(false);
          const state = this.state();
          const importedAssets = normalizeBrowserState({ projects: [], files: [], pages: [], documents: {}, assets: payload.assets }).state.assets;
          const assetIdMap = new Map<string, string>();
          for (const [sourceId, asset] of Object.entries(importedAssets)) {
            const id = state.assets[sourceId] ? uid("asset") : sourceId;
            assetIdMap.set(sourceId, id);
            state.assets[id] = { ...asset, id };
          }
          for (const incomingValue of payload.files) {
            if (!incomingValue || typeof incomingValue !== "object") return resolve(false);
            const incoming = incomingValue as DesignFile;
            if (typeof incoming.id !== "string" || typeof incoming.name !== "string") return resolve(false);
            const newFileId = uid("file");
            state.files.push({ ...incoming, id: newFileId, projectId: null, name: `${incoming.name} imported`, trashedAt: null });
            const incomingPages = payload.pages.filter((item): item is PageMeta => Boolean(item) && typeof item === "object" && (item as PageMeta).fileId === incoming.id && typeof (item as PageMeta).id === "string");
            if (!incomingPages.length) return resolve(false);
            for (const page of incomingPages) {
              const newPageId = uid("page");
              state.pages.push({ ...page, id: newPageId, fileId: newFileId, revision: 0 });
              const document = sanitizeDocument((payload.documents as Record<string, unknown>)[page.id]).document;
              for (const node of Object.values(document.nodes)) if (node.type === "image") node.assetId = assetIdMap.get(node.assetId) ?? node.assetId;
              state.documents[newPageId] = document;
            }
          }
          persistBrowserState(state);
          resolve(true);
        } catch { resolve(false); }
      };
      input.click();
    });
  }

  async exportRender(name: string, extension: "svg" | "png", data: string): Promise<boolean> {
    const anchor = document.createElement("a");
    anchor.href = data;
    anchor.download = `${name}.${extension}`;
    anchor.click();
    return true;
  }

  async extensionsList(): Promise<InstalledExtension[]> {
    return structuredClone(loadBrowserExtensions().records);
  }

  async extensionStage(manifest: ExtensionManifest): Promise<InstalledExtension> {
    const state = loadBrowserExtensions();
    const hash = await manifestHash(manifest);
    state.manifests[hash] = structuredClone(manifest);
    let record = state.records.find((item) => item.id === manifest.id);
    if (!record) {
      record = { id: manifest.id, name: manifest.name, enabled: true, activeHash: null, previewHash: null, active: null, preview: null, versions: [] };
      state.records.push(record);
    }
    const previousPreview = record.previewHash;
    if (previousPreview && previousPreview !== hash) {
      record.versions = record.versions.filter((version) => version.hash !== previousPreview || version.status === "release");
      if (!record.versions.some((version) => version.hash === previousPreview) && record.activeHash !== previousPreview) delete state.manifests[previousPreview];
    }
    record.name = manifest.name;
    record.previewHash = hash;
    record.preview = structuredClone(manifest);
    if (!record.versions.some((version) => version.hash === hash)) {
      record.versions.unshift({ hash, version: manifest.version, createdAt: now(), status: "candidate" });
    }
    persistBrowserExtensions(state);
    return structuredClone(record);
  }

  async extensionKeep(extensionId: string, hash: string): Promise<InstalledExtension> {
    const state = loadBrowserExtensions();
    const record = state.records.find((item) => item.id === extensionId);
    if (!record || record.previewHash !== hash || !record.preview) throw new Error("Only the current preview can be kept");
    record.activeHash = hash;
    record.active = structuredClone(record.preview);
    record.previewHash = null;
    record.preview = null;
    record.enabled = true;
    const version = record.versions.find((item) => item.hash === hash);
    if (version) version.status = "release";
    persistBrowserExtensions(state);
    return structuredClone(record);
  }

  async extensionDiscard(extensionId: string, hash: string): Promise<InstalledExtension[]> {
    const state = loadBrowserExtensions();
    const record = state.records.find((item) => item.id === extensionId);
    if (!record || record.previewHash !== hash) throw new Error("This candidate is no longer being previewed");
    record.previewHash = null;
    record.preview = null;
    record.versions = record.versions.filter((item) => item.hash !== hash || item.status === "release");
    if (!record.activeHash) state.records = state.records.filter((item) => item.id !== extensionId);
    if (!state.records.some((item) => item.activeHash === hash || item.previewHash === hash || item.versions.some((version) => version.hash === hash))) delete state.manifests[hash];
    persistBrowserExtensions(state);
    return structuredClone(state.records);
  }

  async extensionSetEnabled(extensionId: string, enabled: boolean): Promise<InstalledExtension> {
    const state = loadBrowserExtensions();
    const record = state.records.find((item) => item.id === extensionId);
    if (!record?.activeHash) throw new Error("Keep an extension before enabling it");
    record.enabled = enabled;
    persistBrowserExtensions(state);
    return structuredClone(record);
  }

  async extensionRollback(extensionId: string, hash: string): Promise<InstalledExtension> {
    const state = loadBrowserExtensions();
    const record = state.records.find((item) => item.id === extensionId);
    const version = record?.versions.find((item) => item.hash === hash && item.status === "release");
    const manifest = state.manifests[hash];
    if (!record || !version || !manifest) throw new Error("Rollback requires a kept extension version");
    record.activeHash = hash;
    record.active = structuredClone(manifest);
    record.previewHash = null;
    record.preview = null;
    record.enabled = true;
    persistBrowserExtensions(state);
    return structuredClone(record);
  }

  async extensionRemove(extensionId: string): Promise<InstalledExtension[]> {
    const state = loadBrowserExtensions();
    const record = state.records.find((item) => item.id === extensionId);
    state.records = state.records.filter((item) => item.id !== extensionId);
    record?.versions.forEach((version) => delete state.manifests[version.hash]);
    persistBrowserExtensions(state);
    return structuredClone(state.records);
  }

  async extensionImport(): Promise<unknown | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.figmaboy-extension,application/json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try { resolve(JSON.parse(await file.text())); }
        catch { resolve(null); }
      };
      input.click();
    });
  }
}

class TauriRepository implements Repository {
  library = () => invoke<LibrarySnapshot>("library_snapshot");
  fileThumbnail = (fileId: string) => invoke<string | null>("file_thumbnail", { fileId });
  createProject = (name: string) => invoke<Project>("create_project", { name });
  renameProject = (id: string, name: string) => invoke<void>("rename_project", { id, name });
  trashProject = (id: string) => invoke<void>("trash_project", { id });
  createFile = (projectId: string | null) => invoke<OpenedFile>("create_file", { projectId });
  openFile = (id: string) => invoke<OpenedFile>("open_file", { id });
  renameFile = (id: string, name: string) => invoke<void>("rename_file", { id, name });
  starFile = (id: string, starred: boolean) => invoke<void>("star_file", { id, starred });
  moveFile = (id: string, projectId: string | null) => invoke<void>("move_file", { id, projectId });
  duplicateFile = (id: string) => invoke<DesignFile>("duplicate_file", { id });
  trashFile = (id: string) => invoke<void>("trash_file", { id });
  restoreItem = (kind: "project" | "file", id: string) => invoke<void>("restore_item", { kind, id });
  deleteItem = (kind: "project" | "file", id: string) => invoke<void>("delete_item", { kind, id });
  savePage = (pageId: string, expectedRevision: number, document: PageDocument, thumbnail?: string | null) => invoke<number>("save_page", { pageId, expectedRevision, document, thumbnail });
  savePagePreview = (pageId: string, thumbnail: string) => invoke<void>("save_page_preview", { pageId, thumbnail });
  loadPage = (pageId: string) => invoke<{ page: PageMeta; document: PageDocument }>("load_page", { pageId });
  createPage = (fileId: string, name: string) => invoke<{ page: PageMeta; document: PageDocument }>("create_page", { fileId, name });
  renamePage = (pageId: string, name: string) => invoke<void>("rename_page", { pageId, name });
  duplicatePage = (pageId: string) => invoke<{ page: PageMeta; document: PageDocument }>("duplicate_page", { pageId });
  deletePage = (pageId: string) => invoke<void>("delete_page", { pageId });
  reorderPages = (fileId: string, pageIds: string[]) => invoke<void>("reorder_pages", { fileId, pageIds });
  importImage = () => invoke<ImportedAsset | null>("import_image");
  importImageData = (dataBase64: string) => invoke<ImportedAsset>("import_image_data", { dataBase64 });
  readAsset = (id: string) => invoke<string>("read_asset", { id });
  exportPackage = (kind: "project" | "file", id: string) => invoke<boolean>("export_package", { kind, id });
  importPackage = () => invoke<boolean>("import_package");
  exportRender = (name: string, extension: "svg" | "png", data: string) => invoke<boolean>("export_render", { name, extension, data });
  extensionsList = () => invoke<InstalledExtension[]>("extensions_list");
  extensionStage = (manifest: ExtensionManifest) => invoke<InstalledExtension>("extension_stage", { manifest });
  extensionKeep = (extensionId: string, hash: string) => invoke<InstalledExtension>("extension_keep", { extensionId, hash });
  extensionDiscard = (extensionId: string, hash: string) => invoke<InstalledExtension[]>("extension_discard", { extensionId, hash });
  extensionSetEnabled = (extensionId: string, enabled: boolean) => invoke<InstalledExtension>("extension_set_enabled", { extensionId, enabled });
  extensionRollback = (extensionId: string, hash: string) => invoke<InstalledExtension>("extension_rollback", { extensionId, hash });
  extensionRemove = (extensionId: string) => invoke<InstalledExtension[]>("extension_remove", { extensionId });
  extensionImport = () => invoke<unknown | null>("extension_import");
}

let instance: Repository | null = null;
export function repository(): Repository {
  instance ??= isTauri() ? new TauriRepository() : new BrowserRepository();
  return instance;
}
