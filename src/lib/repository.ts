import { invoke } from "@tauri-apps/api/core";
import type { DesignFile, ImportedAsset, LibrarySnapshot, OpenedFile, PageDocument, PageMeta, Project } from "$lib/domain";
import { emptyDocument, uid } from "$lib/domain";

export interface Repository {
  library(): Promise<LibrarySnapshot>;
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
}

interface BrowserState extends LibrarySnapshot {
  pages: PageMeta[];
  documents: Record<string, PageDocument>;
  assets: Record<string, ImportedAsset>;
}

const STORAGE_KEY = "figmaboy.workspace.v1";
const now = () => new Date().toISOString();

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function loadBrowserState(): BrowserState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw) as BrowserState; }
    catch { localStorage.removeItem(STORAGE_KEY); }
  }
  return { projects: [], files: [], pages: [], documents: {}, assets: {} };
}

function persistBrowserState(state: BrowserState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

class BrowserRepository implements Repository {
  private state(): BrowserState { return loadBrowserState(); }

  async library(): Promise<LibrarySnapshot> {
    const { projects, files } = this.state();
    return { projects, files };
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
          const payload = JSON.parse(await file.text());
          if (payload?.manifest?.format !== "figmaboy" || payload?.manifest?.schemaVersion !== 1) return resolve(false);
          const state = this.state();
          Object.assign(state.assets, payload.assets ?? {});
          for (const incoming of payload.files ?? []) {
            const newFileId = uid("file");
            state.files.push({ ...incoming, id: newFileId, projectId: null, name: `${incoming.name} imported`, trashedAt: null });
            for (const page of (payload.pages ?? []).filter((item: PageMeta) => item.fileId === incoming.id)) {
              const newPageId = uid("page");
              state.pages.push({ ...page, id: newPageId, fileId: newFileId, revision: 0 });
              state.documents[newPageId] = structuredClone(payload.documents[page.id]);
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
}

class TauriRepository implements Repository {
  library = () => invoke<LibrarySnapshot>("library_snapshot");
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
}

let instance: Repository | null = null;
export function repository(): Repository {
  instance ??= isTauri() ? new TauriRepository() : new BrowserRepository();
  return instance;
}
