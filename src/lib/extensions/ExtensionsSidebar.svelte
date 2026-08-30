<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowCounterClockwise, DownloadSimple, Package, Power, Trash, X } from "phosphor-svelte";
  import type { EditorSession } from "$lib/editor/editor.svelte";
  import { DesignService } from "$lib/editor/design-service";
  import { repository } from "$lib/repository";
  import { parseExtensionManifest } from "$lib/extensions/manifest";
  import { EXTENSIONS_CHANGED_EVENT } from "$lib/extensions/staging";
  import ExtensionPanel from "$lib/extensions/ExtensionPanel.svelte";
  import type { InstalledExtension } from "$lib/extensions/types";

  let { session, onClose }: { session: EditorSession; onClose: () => void } = $props();
  const repo = repository();
  const design = $derived(new DesignService(session));
  let extensions = $state<InstalledExtension[]>([]);
  let tab = $state<"panels" | "manage">("panels");
  let loading = $state(true);
  let working = $state(false);
  let error = $state("");

  const visible = $derived(extensions.flatMap((extension) => {
    if (extension.preview) return [{ extension, manifest: extension.preview, trial: true }];
    if (extension.enabled && extension.active) return [{ extension, manifest: extension.active, trial: false }];
    return [];
  }));

  async function reloadExtensions() {
    try { extensions = await repo.extensionsList(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not load extensions"; }
    finally { loading = false; }
  }

  onMount(() => {
    const reload = () => void reloadExtensions();
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, reload);
    void reloadExtensions();
    return () => window.removeEventListener(EXTENSIONS_CHANGED_EVENT, reload);
  });

  function replace(record: InstalledExtension) {
    extensions = [...extensions.filter((item) => item.id !== record.id), record].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function importExtension() {
    error = "";
    working = true;
    try {
      const value = await repo.extensionImport();
      if (value === null) return;
      const manifest = parseExtensionManifest(value);
      replace(await repo.extensionStage(manifest));
      tab = "panels";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not import this extension";
    } finally { working = false; }
  }

  async function keep(extension: InstalledExtension) {
    if (!extension.previewHash) return;
    const previous = new Set(extension.active?.permissions ?? []);
    const added = extension.preview?.permissions.filter((permission) => !previous.has(permission)) ?? [];
    if (added.length && !confirm(`${extension.name} requests: ${added.join(", ")}. Keep this version and grant these permissions?`)) return;
    working = true; error = "";
    try { replace(await repo.extensionKeep(extension.id, extension.previewHash)); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not keep this extension"; }
    finally { working = false; }
  }

  async function discard(extension: InstalledExtension) {
    if (!extension.previewHash) return;
    if (session.hasExternalPreview) session.cancelExternalPreview();
    working = true; error = "";
    try { extensions = await repo.extensionDiscard(extension.id, extension.previewHash); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not discard this extension"; }
    finally { working = false; }
  }

  async function toggle(extension: InstalledExtension) {
    if (session.hasExternalPreview) session.cancelExternalPreview();
    working = true; error = "";
    try { replace(await repo.extensionSetEnabled(extension.id, !extension.enabled)); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not change this extension"; }
    finally { working = false; }
  }

  async function rollback(extension: InstalledExtension, hash: string) {
    if (!hash || hash === extension.activeHash) return;
    working = true; error = "";
    try { replace(await repo.extensionRollback(extension.id, hash)); tab = "panels"; }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not restore this version"; }
    finally { working = false; }
  }

  async function remove(extension: InstalledExtension) {
    if (!confirm(`Remove ${extension.name} and its saved versions from this device?`)) return;
    if (session.hasExternalPreview) session.cancelExternalPreview();
    working = true; error = "";
    try { extensions = await repo.extensionRemove(extension.id); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not remove this extension"; }
    finally { working = false; }
  }

  function close() { if (session.hasExternalPreview) session.cancelExternalPreview(); onClose(); }
</script>

<aside class="extensions-sidebar" data-extensions-sidebar>
  <header class="titlebar"><strong>Extensions</strong><div><button title="Import extension" aria-label="Import extension" disabled={working} onclick={importExtension}><DownloadSimple size={16} /></button><button title="Close extensions" aria-label="Close extensions" onclick={close}><X size={16} /></button></div></header>
  <nav><button class:active={tab === "panels"} onclick={() => (tab = "panels")}>Panels</button><button class:active={tab === "manage"} onclick={() => (tab = "manage")}>Manage</button></nav>

  {#if error}<div class="banner" role="alert">{error}<button aria-label="Dismiss" onclick={() => (error = "")}><X size={13} /></button></div>{/if}

  <div class="body">
    {#if loading}
      <div class="empty">Loading extensions…</div>
    {:else if tab === "panels"}
      {#if visible.length === 0}
        <div class="empty"><Package size={28} /><strong>Create extensions with Codex</strong><p>Ask Codex to turn a repeatable workflow into a reusable tool, or import one manually.</p><button onclick={importExtension} disabled={working}><DownloadSimple size={14} />Import extension</button></div>
      {:else}
        {#each visible as item (item.extension.id + (item.extension.previewHash ?? item.extension.activeHash))}
          {#if item.trial}
            <div class="trial"><div><strong>{item.manifest.name}</strong><span>Version {item.manifest.version} is running as a trial.</span></div><button onclick={() => discard(item.extension)} disabled={working}>Discard</button><button class="keep" onclick={() => keep(item.extension)} disabled={working}>Keep</button></div>
          {/if}
          {#each item.manifest.contributes.sidebar as panel (panel.id)}
            <ExtensionPanel manifest={item.manifest} {panel} service={design} trial={item.trial} selectionCount={session.selectedIds.length} />
          {/each}
        {/each}
      {/if}
    {:else}
      <div class="manage-list">
        <button class="import-row" onclick={importExtension} disabled={working}><DownloadSimple size={15} />Import extension file</button>
        {#each extensions as extension (extension.id)}
          <article class="extension-row">
            <div class="extension-name"><div><strong>{extension.name}</strong><span>{extension.active ? `Version ${extension.active.version}` : "Trial only"}</span></div><div class="row-actions">{#if extension.active}<button class:enabled={extension.enabled} title={extension.enabled ? "Disable" : "Enable"} onclick={() => toggle(extension)} disabled={working}><Power size={15} weight={extension.enabled ? "fill" : "regular"} /></button>{/if}<button class="remove" title="Remove extension" onclick={() => remove(extension)} disabled={working}><Trash size={15} /></button></div></div>
            {#if extension.preview}<p class="candidate">Trial version {extension.preview.version} is ready in Panels.</p>{/if}
            {#if extension.versions.filter((version) => version.status === "release").length > 1}
              <label class="versions"><ArrowCounterClockwise size={14} /><select value={extension.activeHash ?? ""} onchange={(event) => rollback(extension, event.currentTarget.value)} disabled={working}>{#each extension.versions.filter((version) => version.status === "release") as version}<option value={version.hash}>{version.version}{version.hash === extension.activeHash ? " · active" : ""}</option>{/each}</select></label>
            {/if}
            <div class="permissions">{#each (extension.preview ?? extension.active)?.permissions ?? [] as permission}<span>{permission}</span>{/each}</div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .extensions-sidebar { position: relative; width: 100%; height: 100%; min-width: 0; display: flex; flex-direction: column; background: #242426; color: #e8e8ea; }
  .titlebar { height: 48px; flex: 0 0 auto; padding: 0 8px 0 13px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3b3b40; }.titlebar strong { font-size: var(--text-emphasis); font-weight: var(--weight-semibold); }.titlebar div { display: flex; gap: 2px; }.titlebar button { width: 30px; height: 30px; border: 0; border-radius: 5px; display: grid; place-items: center; background: transparent; color: #aaaab0; cursor: pointer; }.titlebar button:hover { background: #37373b; color: white; }
  nav { height: 35px; flex: 0 0 auto; display: flex; padding: 0 8px; gap: 2px; border-bottom: 1px solid #38383d; }nav button { flex: 1; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #909097; cursor: pointer; font-size: var(--text-control); }nav button.active { border-bottom-color: var(--blue); color: #f1f1f2; }
  .body { min-height: 0; flex: 1; overflow: auto; }.empty { min-height: 220px; padding: 36px 22px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #787880; text-align: center; font-size: var(--text-control); }.empty strong { color: #d3d3d7; font-size: var(--text-body); }.empty p { max-width: 210px; margin: 0 0 8px; line-height: var(--leading-body); }.empty button,.import-row { min-height: 31px; padding: 0 11px; border: 1px solid #4a4a50; border-radius: 6px; background: #343438; color: #e5e5e7; display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: var(--text-control); }
  .trial { margin: 8px; padding: 9px; display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 7px; border: 1px solid #665692; border-radius: 7px; background: #332d42; }.trial div { min-width: 0; display: grid; gap: 2px; }.trial strong { font-size: var(--text-control); }.trial span { color: #aaa0c5; font-size: var(--text-caption); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.trial button { height: 27px; padding: 0 8px; border: 1px solid #5a536c; border-radius: 5px; background: #40394f; color: #ded9ea; cursor: pointer; font-size: var(--text-small); }.trial .keep { border-color: #238bd2; background: #1176bb; color: white; display: flex; align-items: center; gap: 4px; }
  .banner { margin: 8px 8px 0; padding: 8px; border-radius: 6px; display: flex; gap: 7px; align-items: flex-start; justify-content: space-between; background: #4a292b; color: #fecaca; font-size: var(--text-small); }.banner button { border: 0; background: transparent; color: inherit; cursor: pointer; }
  .manage-list { padding: 8px; display: grid; gap: 8px; }.import-row { width: 100%; justify-content: center; }.extension-row { border: 1px solid #3e3e43; border-radius: 7px; background: #29292c; padding: 10px; display: grid; gap: 8px; }.extension-name { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.extension-name > div:first-child { display: grid; gap: 2px; }.extension-name strong { font-size: var(--text-control); }.extension-name span { color: #85858c; font-size: var(--text-caption); }.extension-name .row-actions { display: flex; gap: 4px; }.extension-name button { width: 29px; height: 27px; border: 1px solid #46464b; border-radius: 5px; background: #343438; color: #77777e; display: grid; place-items: center; cursor: pointer; }.extension-name button.enabled { color: #6ee7a2; }.extension-name button.remove:hover { color: #fca5a5; }.candidate { margin: 0; color: #c4b5fd; font-size: var(--text-small); }.versions { height: 29px; display: flex; align-items: center; gap: 6px; color: #898990; }.versions select { min-width: 0; flex: 1; height: 28px; font-size: var(--text-small); }.permissions { display: flex; flex-wrap: wrap; gap: 4px; }.permissions span { padding: 2px 5px; border-radius: 4px; background: #36363a; color: #9999a0; font-size: var(--text-micro); font-family: var(--font-code); }
</style>
