<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    ArchiveRestore, ChevronDown, Clock3, FilePlus2, Folder, FolderPlus, Grid2X2, Import,
    LayoutGrid, List, MoreHorizontal, Search, Star, Trash2, Upload, X,
  } from "lucide-svelte";
  import type { DesignFile, LibrarySnapshot, Project } from "$lib/domain";
  import { repository } from "$lib/repository";

  type Section = "recents" | "drafts" | "starred" | "projects" | "trash" | `project:${string}`;
  const repo = repository();
  let snapshot = $state<LibrarySnapshot>({ projects: [], files: [] });
  let section = $state<Section>("recents");
  let query = $state("");
  let sort = $state<"updated" | "name">("updated");
  let layout = $state<"grid" | "list">("grid");
  let loading = $state(true);
  let error = $state("");
  let modal = $state<{ kind: "project" | "rename-project" | "rename-file"; id?: string; value: string } | null>(null);
  let menu = $state<{ kind: "project" | "file"; id: string; x: number; y: number } | null>(null);

  const activeProjects = $derived(snapshot.projects.filter((project) => !project.trashedAt));
  const activeProject = $derived(section.startsWith("project:") ? activeProjects.find((project) => project.id === section.slice(8)) : null);
  const heading = $derived(
    section === "recents" ? "Recently viewed" : section === "drafts" ? "Drafts" : section === "starred" ? "Starred" :
    section === "projects" ? "All projects" : section === "trash" ? "Trash" : activeProject?.name ?? "Project"
  );
  const visibleFiles = $derived.by(() => {
    let files = snapshot.files.filter((file) => {
      if (section === "trash") return Boolean(file.trashedAt);
      if (file.trashedAt) return false;
      if (section === "drafts") return !file.projectId;
      if (section === "starred") return file.starred;
      if (section.startsWith("project:")) return file.projectId === section.slice(8);
      return true;
    });
    const normalized = query.trim().toLowerCase();
    if (normalized) files = files.filter((file) => file.name.toLowerCase().includes(normalized) || projectName(file).toLowerCase().includes(normalized));
    return [...files].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
  });
  const visibleProjects = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    const projects = section === "trash" ? snapshot.projects.filter((project) => project.trashedAt) : activeProjects;
    return projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
  });

  onMount(refresh);

  async function refresh() {
    loading = true;
    try { snapshot = await repo.library(); error = ""; }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not load your workspace"; }
    finally { loading = false; }
  }

  function projectName(file: DesignFile): string {
    return snapshot.projects.find((project) => project.id === file.projectId)?.name ?? "Drafts";
  }

  async function newDesign() {
    try {
      const projectId = section.startsWith("project:") ? section.slice(8) : null;
      const opened = await repo.createFile(projectId);
      await goto(`/editor/${opened.file.id}`);
    } catch (cause) { error = cause instanceof Error ? cause.message : "Could not create the design"; }
  }

  async function submitModal(event: SubmitEvent) {
    event.preventDefault();
    if (!modal?.value.trim()) return;
    try {
      if (modal.kind === "project") {
        const project = await repo.createProject(modal.value.trim());
        section = `project:${project.id}`;
      } else if (modal.kind === "rename-project" && modal.id) await repo.renameProject(modal.id, modal.value.trim());
      else if (modal.kind === "rename-file" && modal.id) await repo.renameFile(modal.id, modal.value.trim());
      modal = null;
      await refresh();
    } catch (cause) { error = cause instanceof Error ? cause.message : "That action could not be completed"; }
  }

  function showMenu(event: MouseEvent, kind: "project" | "file", id: string) {
    event.preventDefault();
    event.stopPropagation();
    menu = { kind, id, x: Math.min(event.clientX, innerWidth - 220), y: Math.min(event.clientY, innerHeight - 280) };
  }

  async function fileAction(action: string, file: DesignFile) {
    menu = null;
    try {
      if (action === "open") await goto(`/editor/${file.id}`);
      if (action === "rename") modal = { kind: "rename-file", id: file.id, value: file.name };
      if (action === "star") await repo.starFile(file.id, !file.starred);
      if (action === "duplicate") await repo.duplicateFile(file.id);
      if (action === "trash") await repo.trashFile(file.id);
      if (action === "restore") await repo.restoreItem("file", file.id);
      if (action === "delete" && confirm(`Permanently delete “${file.name}”? This cannot be undone.`)) await repo.deleteItem("file", file.id);
      if (action === "export") await repo.exportPackage("file", file.id);
      await refresh();
    } catch (cause) { error = cause instanceof Error ? cause.message : "That action could not be completed"; }
  }

  async function projectAction(action: string, project: Project) {
    menu = null;
    try {
      if (action === "open") section = `project:${project.id}`;
      if (action === "rename") modal = { kind: "rename-project", id: project.id, value: project.name };
      if (action === "trash") await repo.trashProject(project.id);
      if (action === "restore") await repo.restoreItem("project", project.id);
      if (action === "delete" && confirm(`Permanently delete “${project.name}” and its files?`)) await repo.deleteItem("project", project.id);
      if (action === "export") await repo.exportPackage("project", project.id);
      await refresh();
    } catch (cause) { error = cause instanceof Error ? cause.message : "That action could not be completed"; }
  }

  async function importPackage() {
    try { if (await repo.importPackage()) await refresh(); else error = "No compatible Figmaboy package was imported."; }
    catch (cause) { error = cause instanceof Error ? cause.message : "The package could not be imported"; }
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    const distance = Date.now() - date.getTime();
    if (distance < 60_000) return "Just now";
    if (distance < 3_600_000) return `${Math.floor(distance / 60_000)}m ago`;
    if (distance < 86_400_000) return `${Math.floor(distance / 3_600_000)}h ago`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }

  function focus(node: HTMLElement) { queueMicrotask(() => node.focus()); }
</script>

<svelte:head><title>{heading} · Figmaboy</title></svelte:head>
<svelte:window onclick={() => (menu = null)} />

<div class="browser-shell">
  <aside class="sidebar">
    <div class="brand">
      <img class="brand-mark" src="/figmaboy.svg" alt="" />
      <div><strong>Figmaboy</strong><small>Local workspace</small></div>
      <ChevronDown size={14} />
    </div>

    <nav aria-label="Workspace navigation">
      <button class:active={section === "recents"} onclick={() => (section = "recents")}><Clock3 size={16} /> Recents</button>
      <button class:active={section === "drafts"} onclick={() => (section = "drafts")}><FilePlus2 size={16} /> Drafts</button>
      <button class:active={section === "starred"} onclick={() => (section = "starred")}><Star size={16} /> Starred</button>
      <button class:active={section === "projects"} onclick={() => (section = "projects")}><LayoutGrid size={16} /> All projects</button>
      <button class:active={section === "trash"} onclick={() => (section = "trash")}><Trash2 size={16} /> Trash</button>
    </nav>

    <div class="sidebar-heading"><span>Projects</span><button title="New project" onclick={() => (modal = { kind: "project", value: "" })}><FolderPlus size={15} /></button></div>
    <div class="project-links">
      {#each activeProjects as project}
        <button class:active={section === `project:${project.id}`} onclick={() => (section = `project:${project.id}`)} oncontextmenu={(event) => showMenu(event, "project", project.id)}>
          <Folder size={15} /><span>{project.name}</span>
        </button>
      {/each}
      {#if activeProjects.length === 0}<p>No projects yet</p>{/if}
    </div>
    <div class="local-badge"><span></span><div><strong>Stored on this device</strong><small>Private by default</small></div></div>
  </aside>

  <main class="workspace">
    <header class="topbar">
      <div class="search"><Search size={17} /><input bind:value={query} placeholder="Search files and projects" aria-label="Search" />{#if query}<button onclick={() => (query = "")}><X size={14} /></button>{/if}</div>
      <button class="secondary" onclick={importPackage}><Import size={16} /> Import</button>
      <button class="primary" onclick={newDesign}><FilePlus2 size={16} /> New design</button>
    </header>

    <section class="content">
      <div class="content-heading">
        <div><p>Workspace</p><h1>{heading}</h1>{#if activeProject}<span>{visibleFiles.length} design{visibleFiles.length === 1 ? "" : "s"}</span>{/if}</div>
        <div class="view-controls">
          <label>Sort <select bind:value={sort}><option value="updated">Last updated</option><option value="name">Name</option></select></label>
          <div class="segmented"><button class:active={layout === "grid"} title="Grid view" onclick={() => (layout = "grid")}><Grid2X2 size={15} /></button><button class:active={layout === "list"} title="List view" onclick={() => (layout = "list")}><List size={16} /></button></div>
          {#if section === "projects"}<button class="primary compact" onclick={() => (modal = { kind: "project", value: "" })}><FolderPlus size={15} /> New project</button>{/if}
        </div>
      </div>

      {#if error}<div class="error-banner"><span>{error}</span><button onclick={() => (error = "")}><X size={15} /></button></div>{/if}

      {#if loading}
        <div class="workspace-loading" role="status" aria-live="polite">
          <img src="/figmaboy.svg" alt="" />
          <strong>Figmaboy</strong>
          <span>Opening your local workspace…</span>
        </div>
      {:else}
        {#if section === "projects" || section === "trash"}
          {#if visibleProjects.length > 0}
            <h2>{section === "trash" ? "Deleted projects" : "Projects"}</h2>
            <div class="project-grid">
              {#each visibleProjects as project}
                <div class="project-card" role="button" tabindex="0" onclick={() => section === "trash" ? undefined : (section = `project:${project.id}`)} onkeydown={(event) => event.key === "Enter" && (section = `project:${project.id}`)} oncontextmenu={(event) => showMenu(event, "project", project.id)}>
                  <div class="folder-art"><Folder size={34} strokeWidth={1.4} /><div class="mini-files">{#each snapshot.files.filter((file) => file.projectId === project.id).slice(0, 3) as file}<span style:background-image={file.thumbnail ? `url(${file.thumbnail})` : "none"}></span>{/each}</div></div>
                  <div><strong>{project.name}</strong><span>{snapshot.files.filter((file) => file.projectId === project.id && !file.trashedAt).length} files · Updated {formatDate(project.updatedAt)}</span></div>
                  <button class="more" onclick={(event) => showMenu(event, "project", project.id)} aria-label={`Actions for ${project.name}`}><MoreHorizontal size={17} /></button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        {#if section !== "projects" || activeProject}
          {#if visibleFiles.length > 0}
            {#if section === "trash"}<h2>Deleted files</h2>{/if}
            <div class:file-list={layout === "list"} class:file-grid={layout === "grid"}>
              {#each visibleFiles as file}
                <div class="file-card" role="button" tabindex="0" onclick={() => section === "trash" ? undefined : fileAction("open", file)} onkeydown={(event) => event.key === "Enter" && section !== "trash" && fileAction("open", file)} oncontextmenu={(event) => showMenu(event, "file", file.id)}>
                  <div class="thumbnail" class:empty={!file.thumbnail} style:background-image={file.thumbnail ? `url(${file.thumbnail})` : "none"}>
                    {#if !file.thumbnail}<div class="blank-file"><span></span><span></span><span></span></div>{/if}
                    <button class:starred={file.starred} class="star" title={file.starred ? "Remove from starred" : "Add to starred"} onclick={(event) => { event.stopPropagation(); fileAction("star", file); }}><Star size={16} fill={file.starred ? "currentColor" : "none"} /></button>
                  </div>
                  <div class="file-info"><strong>{file.name}</strong><span>{projectName(file)} · {formatDate(file.updatedAt)}</span></div>
                  <button class="more" onclick={(event) => showMenu(event, "file", file.id)} aria-label={`Actions for ${file.name}`}><MoreHorizontal size={17} /></button>
                </div>
              {/each}
            </div>
          {:else if !(section === "projects" && visibleProjects.length)}
            <div class="empty-state">
              <div class="empty-icon">{#if section === "trash"}<Trash2 size={30} />{:else}<FilePlus2 size={30} />{/if}</div>
              <h2>{section === "trash" ? "Trash is empty" : query ? "No matching designs" : "Nothing here yet"}</h2>
              <p>{section === "trash" ? "Deleted projects and files will appear here." : query ? "Try a different search term." : "Create a blank design and start shaping your next idea."}</p>
              {#if section !== "trash" && !query}<button class="primary" onclick={newDesign}><FilePlus2 size={16} /> New design</button>{/if}
            </div>
          {/if}
        {/if}
      {/if}
    </section>
  </main>
</div>

{#if menu}
  {@const targetFile = menu.kind === "file" ? snapshot.files.find((item) => item.id === menu?.id) : undefined}
  {@const targetProject = menu.kind === "project" ? snapshot.projects.find((item) => item.id === menu?.id) : undefined}
  <div class="context-menu dashboard-menu" role="menu" tabindex="-1" style:left={`${menu.x}px`} style:top={`${menu.y}px`} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && (menu = null)}>
    {#if targetFile}
      {#if !targetFile.trashedAt}
        <button onclick={() => fileAction("open", targetFile)}>Open <span>↵</span></button>
        <button onclick={() => fileAction("rename", targetFile)}>Rename</button>
        <button onclick={() => fileAction("star", targetFile)}>{targetFile.starred ? "Remove from starred" : "Add to starred"}</button>
        <button onclick={() => fileAction("duplicate", targetFile)}>Duplicate</button>
        <button onclick={() => fileAction("export", targetFile)}><Upload size={14} /> Export package</button>
        <hr /><button class="danger" onclick={() => fileAction("trash", targetFile)}><Trash2 size={14} /> Move to trash</button>
      {:else}
        <button onclick={() => fileAction("restore", targetFile)}><ArchiveRestore size={14} /> Restore</button>
        <button class="danger" onclick={() => fileAction("delete", targetFile)}><Trash2 size={14} /> Delete permanently</button>
      {/if}
    {:else if targetProject}
      {#if !targetProject.trashedAt}
        <button onclick={() => projectAction("open", targetProject)}>Open</button><button onclick={() => projectAction("rename", targetProject)}>Rename</button>
        <button onclick={() => projectAction("export", targetProject)}><Upload size={14} /> Export package</button><hr />
        <button class="danger" onclick={() => projectAction("trash", targetProject)}><Trash2 size={14} /> Move to trash</button>
      {:else}
        <button onclick={() => projectAction("restore", targetProject)}><ArchiveRestore size={14} /> Restore</button>
        <button class="danger" onclick={() => projectAction("delete", targetProject)}><Trash2 size={14} /> Delete permanently</button>
      {/if}
    {/if}
  </div>
{/if}

{#if modal}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (modal = null)}>
    <form class="modal" onsubmit={submitModal}>
      <div class="modal-icon">{#if modal.kind === "project"}<FolderPlus size={20} />{:else}<FilePlus2 size={20} />{/if}</div>
      <h2>{modal.kind === "project" ? "Create a project" : "Rename"}</h2>
      <p>{modal.kind === "project" ? "Projects keep related design files together." : "Choose a clear name for this item."}</p>
      <input use:focus bind:value={modal.value} placeholder={modal.kind === "project" ? "Project name" : "Name"} />
      <div class="modal-actions"><button type="button" class="secondary" onclick={() => (modal = null)}>Cancel</button><button class="primary" type="submit">{modal.kind === "project" ? "Create project" : "Save"}</button></div>
    </form>
  </div>
{/if}

<style>
  .browser-shell { width: 100vw; height: 100vh; display: grid; grid-template-columns: 248px 1fr; background: #191919; }
  .sidebar { background: #202020; border-right: 1px solid #333; display: flex; flex-direction: column; min-width: 0; }
  .brand { height: 66px; padding: 0 16px; display: flex; gap: 10px; align-items: center; border-bottom: 1px solid #303030; }
  .brand > div:nth-child(2) { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .brand strong { font-size: 13px; letter-spacing: -.01em; }.brand small { color: #8f8f96; font-size: 10px; margin-top: 2px; }
  .brand-mark { width: 28px; height: 36px; object-fit: contain; filter: drop-shadow(0 3px 7px #0007); }
  nav { padding: 14px 10px 8px; display: grid; gap: 2px; }
  nav button, .project-links button { border: 0; background: transparent; height: 34px; border-radius: 6px; padding: 0 10px; display: flex; align-items: center; gap: 10px; color: #b9b9be; text-align: left; cursor: pointer; font-size: 12px; }
  nav button:hover, nav button.active, .project-links button:hover, .project-links button.active { background: #303030; color: white; }
  .sidebar-heading { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 7px 20px; color: #77777e; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .sidebar-heading button { border: 0; background: transparent; color: #999; padding: 4px; border-radius: 4px; cursor: pointer; }.sidebar-heading button:hover { background: #333; color: white; }
  .project-links { padding: 0 10px; overflow: auto; }.project-links button { width: 100%; }.project-links button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.project-links p { margin: 9px 10px; color: #666; font-size: 11px; }
  .local-badge { margin: auto 12px 14px; border: 1px solid #343434; border-radius: 8px; padding: 10px; display: flex; gap: 9px; align-items: center; background: #242424; }
  .local-badge > span { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px #22c55e22; }.local-badge div { display: flex; flex-direction: column; }.local-badge strong { font-size: 10px; }.local-badge small { color: #777; font-size: 9px; margin-top: 2px; }
  .workspace { min-width: 0; display: flex; flex-direction: column; background: #181818; }
  .topbar { height: 66px; padding: 0 28px; border-bottom: 1px solid #303030; display: flex; align-items: center; gap: 10px; background: #1d1d1d; }
  .search { width: min(430px, 45vw); height: 36px; border: 1px solid #3a3a3a; background: #272727; border-radius: 8px; display: flex; align-items: center; padding: 0 10px; gap: 8px; color: #8e8e95; }.search:focus-within { border-color: #0d99ff; box-shadow: 0 0 0 1px #0d99ff; }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; color: white; background: transparent; font-size: 12px; }.search button { border: 0; background: transparent; color: #888; display: grid; padding: 2px; cursor: pointer; }
  .topbar .secondary { margin-left: auto; }
  .primary, .secondary { height: 36px; border-radius: 7px; padding: 0 13px; border: 0; display: inline-flex; gap: 7px; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .primary { background: var(--blue); color: white; }.primary:hover { background: var(--blue-hover); }.secondary { background: #2c2c2c; border: 1px solid #414141; }.secondary:hover { background: #363636; }.compact { height: 32px; }
  .content { flex: 1; overflow: auto; padding: 30px clamp(24px, 4vw, 56px) 80px; }
  .content-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 30px; }.content-heading p { margin: 0 0 5px; color: #73737b; font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: .09em; }.content-heading h1 { margin: 0; font-size: 25px; letter-spacing: -.03em; }.content-heading > div > span { display: inline-block; margin-top: 7px; color: #777; font-size: 11px; }
  .view-controls { display: flex; align-items: center; gap: 10px; }.view-controls label { color: #777; font-size: 10px; display: flex; align-items: center; gap: 7px; }.view-controls select { background-color: #252525; border: 1px solid #383838; color: #c9c9ce; height: 32px; border-radius: 6px; padding: 0 26px 0 9px; font-size: 11px; }
  .segmented { display: flex; border: 1px solid #393939; border-radius: 6px; overflow: hidden; }.segmented button { width: 32px; height: 30px; border: 0; background: #232323; color: #777; display: grid; place-items: center; cursor: pointer; }.segmented button.active { background: #353535; color: white; }
  h2 { font-size: 11px; margin: 28px 0 12px; color: #aaaab0; text-transform: uppercase; letter-spacing: .06em; }
  .project-grid, .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  .workspace-loading { min-height: 54vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .workspace-loading img { width: 86px; height: 120px; object-fit: contain; filter: drop-shadow(0 14px 26px #0009); animation: logo-breathe 1.8s ease-in-out infinite; }
  .workspace-loading strong { margin-top: 19px; font-size: 15px; letter-spacing: -.02em; }
  .workspace-loading span { margin-top: 6px; color: #74747c; font-size: 10px; }
  .project-card, .file-card { min-width: 0; position: relative; border: 1px solid #353535; border-radius: 10px; background: #222; overflow: hidden; cursor: pointer; transition: border-color .15s, transform .15s, background .15s; }.project-card:hover, .file-card:hover { border-color: #555; transform: translateY(-1px); background: #252525; }
  .project-card { min-height: 116px; display: flex; align-items: center; padding: 15px; gap: 14px; }.folder-art { width: 78px; height: 78px; flex: 0 0 auto; border-radius: 8px; background: linear-gradient(145deg,#333,#292929); display: grid; place-items: center; color: #a78bfa; position: relative; }.mini-files { position: absolute; bottom: 7px; right: 7px; display: flex; }.mini-files span { width: 17px; height: 20px; background: #555 center/cover; border: 1px solid #777; border-radius: 2px; margin-left: -5px; }.project-card > div:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }.project-card strong, .file-info strong { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.project-card span, .file-info span { margin-top: 6px; color: #777; font-size: 10px; }
  .thumbnail { height: 160px; background: #313131 center/cover no-repeat; border-bottom: 1px solid #353535; position: relative; display: grid; place-items: center; }.thumbnail.empty { background: radial-gradient(circle at 50% 25%,#383838,#2a2a2a); }.blank-file { width: 76px; height: 58px; border: 1px solid #505050; background: #303030; border-radius: 3px; padding: 13px; display: grid; gap: 6px; box-shadow: 0 8px 24px #0003; }.blank-file span { display: block; height: 3px; border-radius: 2px; background: #555; }.blank-file span:nth-child(2) { width: 70%; }.blank-file span:nth-child(3) { width: 45%; }
  .file-info { padding: 12px 40px 13px 13px; display: flex; flex-direction: column; }.file-info span { margin-top: 4px; }
  .more { border: 0; background: transparent; color: #777; position: absolute; right: 8px; bottom: 15px; width: 28px; height: 28px; border-radius: 5px; display: grid; place-items: center; cursor: pointer; }.more:hover { background: #3a3a3a; color: white; }
  .star { position: absolute; right: 9px; top: 9px; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 6px; background: #1d1d1dcc; color: #aaa; opacity: 0; cursor: pointer; }.file-card:hover .star, .star.starred { opacity: 1; }.star.starred { color: #facc15; }
  .file-list { display: grid; gap: 1px; border: 1px solid #333; border-radius: 9px; overflow: hidden; }.file-list .file-card { border: 0; border-radius: 0; display: grid; grid-template-columns: 74px 1fr; height: 64px; }.file-list .thumbnail { height: 64px; border: 0; }.file-list .blank-file { transform: scale(.45); }.file-list .file-info { justify-content: center; }
  .empty-state { min-height: 48vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.empty-state .empty-icon { width: 64px; height: 64px; display: grid; place-items: center; border: 1px solid #3a3a3a; border-radius: 16px; background: #242424; color: #777; }.empty-state h2 { margin: 18px 0 0; color: white; text-transform: none; font-size: 16px; letter-spacing: -.01em; }.empty-state p { color: #777; font-size: 11px; margin: 8px 0 18px; max-width: 310px; line-height: 1.5; }
  .error-banner { margin: -12px 0 18px; border: 1px solid #7f1d1d; background: #451a1a; color: #fecaca; min-height: 38px; border-radius: 7px; padding: 9px 11px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; }.error-banner button { border: 0; background: transparent; color: inherit; display: grid; cursor: pointer; }
  @keyframes logo-breathe { 50% { transform: translateY(-3px) scale(.985); opacity: .78; } }
  .context-menu { position: fixed; z-index: 100; width: 205px; padding: 6px; border: 1px solid #444; border-radius: 8px; background: #282828; box-shadow: 0 16px 50px #0009; }.context-menu button { width: 100%; min-height: 32px; border: 0; border-radius: 5px; background: transparent; color: #eee; padding: 0 9px; display: flex; align-items: center; gap: 8px; justify-content: flex-start; cursor: pointer; font-size: 11px; }.context-menu button span { margin-left: auto; color: #777; }.context-menu button:hover { background: #3b3b3b; }.context-menu hr { height: 1px; border: 0; background: #424242; margin: 5px -6px; }.context-menu .danger { color: #fca5a5; }
  .modal-backdrop { position: fixed; inset: 0; z-index: 150; background: #0009; display: grid; place-items: center; backdrop-filter: blur(2px); }.modal { width: min(380px, calc(100vw - 40px)); padding: 25px; border: 1px solid #444; background: #282828; border-radius: 12px; box-shadow: 0 30px 80px #000b; }.modal-icon { width: 40px; height: 40px; display: grid; place-items: center; background: #0d99ff20; color: #38bdf8; border-radius: 10px; }.modal h2 { color: white; text-transform: none; letter-spacing: -.02em; font-size: 17px; margin: 16px 0 6px; }.modal p { color: #888; font-size: 11px; line-height: 1.5; margin: 0 0 18px; }.modal input { width: 100%; height: 38px; border: 1px solid #444; border-radius: 7px; background: #1d1d1d; color: white; padding: 0 10px; outline: none; font-size: 12px; }.modal input:focus { border-color: var(--blue); }.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  @media (prefers-reduced-motion: reduce) { .workspace-loading img { animation: none; } }
  @media (max-width: 820px) { .browser-shell { grid-template-columns: 190px 1fr; }.topbar { padding: 0 15px; }.content { padding-inline: 20px; }.topbar .secondary { display: none; }.view-controls label { display: none; } }
</style>
