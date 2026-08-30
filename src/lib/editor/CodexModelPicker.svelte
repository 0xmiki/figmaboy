<script lang="ts">
  import { onMount } from "svelte";
  import { Check, CaretDown as ChevronDown } from "phosphor-svelte";
  import type { CodexModel } from "$lib/codex-protocol";

  let {
    models,
    selected,
    disabled = false,
    onSelect,
  }: {
    models: CodexModel[];
    selected: string;
    disabled?: boolean;
    onSelect: (model: string) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement>();

  const active = $derived(models.find((model) => model.model === selected || model.id === selected));
  const ordered = $derived(models.toSorted((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.displayName.localeCompare(b.displayName)));

  onMount(() => {
    const close = (event: PointerEvent) => {
      if (open && !root?.contains(event.target as Node)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (open && event.key === "Escape") { event.preventDefault(); open = false; }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape);
    };
  });

  function setOpen(value: boolean) {
    if (disabled) return;
    open = value;
  }

  function choose(model: CodexModel) {
    onSelect(model.model);
    open = false;
  }

</script>

<div class="model-picker" bind:this={root}>
  <button class="trigger" type="button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !models.length} title={active ? `${active.displayName} (${active.model})` : "Choose a model"} onclick={() => setOpen(!open)}>
    <span>{active?.displayName ?? (models.length ? "Choose model" : "No models")}</span><ChevronDown size={11} />
  </button>
  {#if open}
    <section class="picker-popover" aria-label="Choose a Codex model">
      <div class="model-list" role="listbox" aria-label="Codex models">
        {#each ordered as model (model.model)}
          <button class="model-row" class:selected={model.model === selected} role="option" aria-selected={model.model === selected} onclick={() => choose(model)}>
            <strong>{model.displayName}</strong>
            {#if model.model === selected}<Check size={13} />{/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .model-picker { position: static; min-width: 0; }.trigger { height: 31px; max-width: 168px; min-width: 0; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #b4b4bc; display: flex; align-items: center; gap: 5px; cursor: pointer; }.trigger:hover:not(:disabled),.trigger[aria-expanded="true"] { background: #39393e; color: white; }.trigger:disabled { opacity: .45; }.trigger span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--text-body); font-weight: var(--weight-medium); }.trigger :global(svg:last-child) { flex: 0 0 auto; color: #85858d; }
  .picker-popover { position: absolute; z-index: 80; left: 7px; right: 7px; bottom: 44px; width: auto; max-height: min(410px, calc(100vh - 180px)); overflow: hidden; border: 1px solid #4b4b53; border-radius: 10px; background: #28282c; box-shadow: 0 18px 55px #000b; }
  .model-list { max-height: min(398px, calc(100vh - 192px)); overflow-y: auto; padding: 6px; overscroll-behavior: contain; scrollbar-width: thin; }.model-row { width: 100%; min-height: 40px; box-sizing: border-box; padding: 0 10px 0 11px; border: 0; border-radius: 7px; outline: 0; background: transparent; color: #ececf0; display: grid; grid-template-columns: minmax(0,1fr) 16px; gap: 8px; align-items: center; text-align: left; cursor: pointer; }.model-row > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-body); font-weight: var(--weight-semibold); }.model-row:hover,.model-row:focus-visible { background: #35353a; }.model-row.selected { background: #3a3a40; }.model-row :global(svg) { color: #c0b5ff; }
</style>
