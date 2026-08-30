<script lang="ts">
  import { onMount } from "svelte";
  import { CaretDown as ChevronDown, Gauge, Lock, Sparkle as Sparkles, Lightning as Zap } from "phosphor-svelte";
  import { reasoningLabel, serviceTierOptions, type CodexModel, type CodexSelection } from "$lib/codex-protocol";
  import type { CodexApprovalMode } from "$lib/codex-ui-state";

  let { model, selection, approvalMode, disabled = false, onChange, onApprovalModeChange }: {
    model: CodexModel | undefined;
    selection: CodexSelection;
    approvalMode: CodexApprovalMode;
    disabled?: boolean;
    onChange: (selection: CodexSelection) => void;
    onApprovalModeChange: (mode: CodexApprovalMode) => void;
  } = $props();
  let open = $state(false);
  let root: HTMLDivElement;
  const tiers = $derived(serviceTierOptions(model));
  const fast = $derived(tiers.find((tier) => tier.id === selection.serviceTier)?.name.toLowerCase() === "fast");
  const trigger = $derived([selection.effort ? reasoningLabel(selection.effort) : "Default", selection.serviceTier !== "default" ? tiers.find((tier) => tier.id === selection.serviceTier)?.name : null].filter(Boolean).join(" · "));

  onMount(() => {
    const close = (event: PointerEvent) => { if (open && !root?.contains(event.target as Node)) open = false; };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  });

  function update(patch: Partial<CodexSelection>) {
    onChange({ ...selection, ...patch });
    open = false;
  }
</script>

<div class="traits" bind:this={root}>
  <button class="trigger" type="button" disabled={disabled || !model} aria-expanded={open} title="Model settings" onclick={() => (open = !open)}>{#if fast}<Zap size={12} weight="fill" />{:else}<Gauge size={12} />{/if}<span>{trigger}</span><ChevronDown size={11} /></button>
  {#if open && model}
    <section class="traits-menu" aria-label="Codex model settings">
      {#if model.supportedReasoningEfforts.length}
        <div class="section-label"><Sparkles size={12} />Reasoning</div>
        {#each model.supportedReasoningEfforts as option}
          <button class:selected={selection.effort === option.reasoningEffort} onclick={() => update({ effort: option.reasoningEffort })}><strong>{reasoningLabel(option.reasoningEffort)}</strong></button>
        {/each}
      {/if}
      {#if tiers.length > 1}
        <hr /><div class="section-label"><Zap size={12} />Service tier</div>
        {#each tiers as tier}<button class:selected={selection.serviceTier === tier.id} onclick={() => update({ serviceTier: tier.id })}><strong>{tier.name}</strong></button>{/each}
      {/if}
      <hr /><div class="section-label"><Lock size={12} />Approvals</div>
      <button class:selected={approvalMode === "ask"} onclick={() => { onApprovalModeChange("ask"); open = false; }}><strong>Ask</strong></button>
      <button class:selected={approvalMode === "auto"} onclick={() => { onApprovalModeChange("auto"); open = false; }}><strong>Auto review</strong></button>
    </section>
  {/if}
</div>

<style>
  .traits { position: static; min-width: 0; }.trigger { height: 31px; max-width: 142px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #b0b0b8; display: flex; align-items: center; gap: 5px; cursor: pointer; }.trigger:hover:not(:disabled),.trigger[aria-expanded="true"] { color: white; background: #39393e; }.trigger:disabled { opacity: .4; }.trigger span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-body); font-weight: var(--weight-medium); }.trigger :global(svg:last-child) { color: #85858d; }
  .traits-menu { position: absolute; z-index: 81; left: 7px; right: 7px; bottom: 44px; width: auto; max-height: min(430px, calc(100vh - 180px)); overflow-y: auto; padding: 6px; border: 1px solid #4b4b53; border-radius: 9px; background: #29292d; box-shadow: 0 18px 50px #000a; }.section-label { height: 31px; padding: 0 8px; display: flex; align-items: center; gap: 6px; color: #92929a; font-size: var(--text-small); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: .04em; }.traits-menu > button { width: 100%; min-height: 39px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: #dddde2; display: flex; align-items: center; text-align: left; cursor: pointer; }.traits-menu > button:hover,.traits-menu > button.selected { background: #38383e; }.traits-menu strong { font-size: var(--text-body); font-weight: var(--weight-semibold); }.traits-menu hr { height: 1px; margin: 5px -6px; border: 0; background: #3d3d43; }
</style>
