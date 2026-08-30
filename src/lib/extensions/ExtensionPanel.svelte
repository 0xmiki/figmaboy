<script lang="ts">
  import { onMount } from "svelte";
  import { WarningCircle } from "phosphor-svelte";
  import type { DesignService } from "$lib/editor/design-service";
  import type { ExtensionControl, ExtensionManifest, ExtensionSidebarContribution } from "$lib/extensions/types";
  import { initialControlState, runExtensionAction, type ExtensionControlState } from "$lib/extensions/runtime";

  let { manifest, panel, service, trial, selectionCount }: {
    manifest: ExtensionManifest;
    panel: ExtensionSidebarContribution;
    service: DesignService;
    trial: boolean;
    selectionCount: number;
  } = $props();

  let values = $state<ExtensionControlState>({});
  let error = $state("");
  let running = $state<string | null>(null);

  onMount(() => { values = initialControlState(panel.controls); });

  function setValue(id: string, value: string | number | boolean) {
    values[id] = value;
  }

  function run(control: Extract<ExtensionControl, { type: "button" }>) {
    error = "";
    running = control.id;
    try {
      runExtensionAction(service, manifest, control.action, { ...values });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "The canvas action failed";
    } finally {
      running = null;
    }
  }
</script>

{#snippet renderControl(control: ExtensionControl)}
  {#if control.type === "heading"}
    <h4>{control.text}</h4>
  {:else if control.type === "text"}
    <p class="copy" class:muted={control.tone === "muted"} class:warning={control.tone === "warning"}>{control.text}</p>
  {:else if control.type === "divider"}
    <hr />
  {:else if control.type === "number"}
    <label class="field"><span>{control.label}</span><input type="number" value={Number(values[control.id] ?? 0)} min={control.min} max={control.max} step={control.step ?? 1} oninput={(event) => setValue(control.id, event.currentTarget.valueAsNumber)} /></label>
  {:else if control.type === "input"}
    <label class="field stacked"><span>{control.label}</span><input type="text" value={String(values[control.id] ?? "")} placeholder={control.placeholder ?? ""} oninput={(event) => setValue(control.id, event.currentTarget.value)} /></label>
  {:else if control.type === "select"}
    <label class="field stacked"><span>{control.label}</span><select value={String(values[control.id] ?? "")} onchange={(event) => setValue(control.id, event.currentTarget.value)}>{#each control.options as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  {:else if control.type === "checkbox"}
    <label class="check"><input type="checkbox" checked={Boolean(values[control.id])} onchange={(event) => setValue(control.id, event.currentTarget.checked)} /><span>{control.label}</span></label>
  {:else if control.type === "button"}
    <button class="action" class:primary={control.variant === "primary"} class:danger={control.variant === "danger"} disabled={running !== null || (control.requiresSelection && selectionCount === 0)} onclick={() => run(control)}>{running === control.id ? "Working…" : control.label}</button>
  {:else if control.type === "row"}
    <div class="row">{#each control.controls as child}{@render renderControl(child)}{/each}</div>
  {/if}
{/snippet}

<section class="extension-panel">
  <header><div><strong>{panel.title}</strong><span>{manifest.name}</span></div>{#if trial}<em>Trial</em>{/if}</header>
  <div class="controls">{#each panel.controls as control}{@render renderControl(control)}{/each}</div>
  {#if error}<div class="error" role="alert"><WarningCircle size={14} />{error}</div>{/if}
</section>

<style>
  .extension-panel { margin: 8px; border: 1px solid #414146; border-radius: 8px; background: #28282b; overflow: hidden; }
  header { min-height: 45px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #3b3b40; }
  header div { min-width: 0; display: grid; gap: 1px; } header strong { color: #f1f1f2; font-size: var(--text-control); font-weight: var(--weight-semibold); } header span { color: #84848b; font-size: var(--text-caption); }
  header em { padding: 2px 6px; border: 1px solid #826cbe; border-radius: 9px; color: #c4b5fd; font-size: var(--text-caption); font-style: normal; }
  .controls { padding: 10px; display: grid; gap: 9px; } h4 { margin: 0; color: #ececef; font-size: var(--text-control); font-weight: var(--weight-semibold); } .copy { margin: 0; color: #c7c7cc; font-size: var(--text-small); line-height: var(--leading-body); user-select: text; }.copy.muted { color: #85858c; }.copy.warning { color: #f3c982; }
  hr { width: 100%; margin: 2px 0; border: 0; border-top: 1px solid #3e3e43; }.field { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #bdbdc2; font-size: var(--text-small); }.field.stacked { display: grid; gap: 5px; }.field input,.field select { width: 104px; min-width: 0; height: 29px; border: 1px solid #48484d; border-radius: 5px; background: #353538; color: #f0f0f1; padding: 0 8px; font-size: var(--text-control); }.field.stacked input,.field.stacked select { width: 100%; }.check { display: flex; align-items: center; gap: 7px; color: #d4d4d8; font-size: var(--text-control); }.check input { accent-color: var(--blue); }
  .action { width: 100%; min-height: 31px; border: 1px solid #4a4a50; border-radius: 6px; background: #353539; color: #ededee; padding: 5px 9px; cursor: pointer; font-size: var(--text-control); }.action:hover:not(:disabled) { background: #404045; border-color: #5a5a61; }.action.primary { background: #0d82d8; border-color: #1597ef; color: white; }.action.danger { color: #fca5a5; }.action:disabled { opacity: .45; cursor: default; }
  .row { min-width: 0; display: flex; align-items: end; gap: 7px; }.row > :global(*) { flex: 1; min-width: 0; }.error { margin: 0 10px 10px; padding: 7px 8px; display: flex; align-items: flex-start; gap: 6px; border-radius: 5px; background: #4a292b; color: #fecaca; font-size: var(--text-small); }
</style>
