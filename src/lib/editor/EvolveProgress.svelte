<script lang="ts">
  import { ArrowClockwise, CaretDown, Check, Circle, X } from "phosphor-svelte";

  type Activity = {
    id: string;
    pass: number;
    title: string;
    detail: string;
    notes: string[];
    image?: string;
    status: "working" | "complete" | "kept" | "discarded" | "recovering";
  };

  let { stage, stageLabel, pass, kept, discarded, activities, outcome }: {
    stage: string;
    stageLabel: string;
    pass: number;
    kept: number;
    discarded: number;
    activities: Activity[];
    outcome: "running" | "complete" | "stopped" | "error" | null;
  } = $props();

  let open = $state(true);
  const steps = ["Review", "Build", "Render", "Compare"];
  const activeStep = $derived(stage === "design" ? 1 : stage === "preview" ? 2 : stage === "compare" ? 3 : 0);
  const groupedActivities = $derived.by(() => {
    const groups = new Map<number, Activity[]>();
    for (const activity of activities) groups.set(activity.pass, [...(groups.get(activity.pass) ?? []), activity]);
    return [...groups].map(([generation, entries]) => ({ generation, entries }));
  });

  $effect(() => {
    if (outcome === "running") open = true;
    else if (outcome) open = false;
  });

  function ActivityIcon(status: Activity["status"]) {
    if (status === "recovering") return ArrowClockwise;
    if (status === "kept" || status === "complete") return Check;
    if (status === "discarded") return X;
    return Circle;
  }
</script>

<details class="evolve-work" class:complete={outcome === "complete"} class:failed={outcome === "error"} bind:open>
  <summary>
    <span class="live-dot" aria-hidden="true"></span>
    <span class="summary-copy"><strong>{outcome === "complete" ? "Evolution journal" : outcome === "stopped" ? "Stopped evolution" : outcome === "error" ? "Evolution journal" : "Evolving design"}</strong><small>{stageLabel}</small></span>
    <span class="counts">Pass {Math.max(1, pass)} · {kept} accepted · {discarded} rejected</span>
    <CaretDown size={12} />
  </summary>
  <div class="evolve-body">
    <div class="phase-rail" aria-label={`Current evolution step: ${steps[activeStep]}`}>
      {#each steps as step, index}
        <span class:active={outcome === "running" && index === activeStep} class:done={outcome === "complete" || index < activeStep}>{outcome === "complete" || index < activeStep ? "✓" : index + 1} {step}</span>
      {/each}
    </div>
    <div class="activity-list">
      {#each groupedActivities as group (group.generation)}
        <section class="generation-group">
          <h4>{group.generation ? `Pass ${group.generation}` : "Reference and direction"}</h4>
          {#each group.entries as activity (activity.id)}
            {@const Icon = ActivityIcon(activity.status)}
            <div class:active={activity.status === "working"} class:recovering={activity.status === "recovering"} class:kept={activity.status === "kept"} class="activity-row">
              <Icon size={activity.status === "working" ? 7 : 12} weight={activity.status === "working" ? "fill" : "regular"} />
              <span><strong>{activity.title}</strong>{#if activity.detail}<small>{activity.detail}</small>{/if}{#each activity.notes as note}<small class="note">{note}</small>{/each}</span>
              {#if activity.image}<img src={activity.image} alt="" />{/if}
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
</details>

<style>
  .evolve-work { border: 0; border-bottom: 1px solid #3a3a40; background: transparent; color: #94949e; }
  .evolve-work > summary { min-height: 38px; padding: 3px 4px; display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; }
  .evolve-work summary::-webkit-details-marker { display: none; }
  .evolve-work > summary:hover { color: #e2e2e6; }
  .live-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #79b8d1; }
  .complete .live-dot { background: #70b98c; }.failed .live-dot { background: #d16f6f; }
  .summary-copy { min-width: 0; flex: 1; display: grid; gap: 1px; }
  .summary-copy strong { overflow: hidden; color: #d7d7dc; font-size: var(--text-body); font-weight: var(--weight-medium); text-overflow: ellipsis; white-space: nowrap; }
  .summary-copy small,.counts { color: #81818a; font-size: var(--text-caption); font-weight: var(--weight-normal); }
  .summary-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .counts { flex: 0 0 auto; font-family: var(--font-code); }
  .evolve-work > summary :global(svg:last-child) { transition: transform 150ms ease; }
  .evolve-work[open] > summary :global(svg:last-child) { transform: rotate(180deg); }
  .evolve-body { padding: 2px 0 8px 15px; }
  .phase-rail { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 3px; margin: 0 5px 6px; }
  .phase-rail span { min-width: 0; padding: 3px 4px; overflow: hidden; border-top: 2px solid #38383e; color: #666670; font: var(--text-micro)/var(--leading-ui) var(--font-code); text-overflow: ellipsis; white-space: nowrap; }
  .phase-rail span.done { border-color: #4f7860; color: #73907e; }
  .phase-rail span.active { border-color: #6da7bf; color: #a3c9d8; }
  .generation-group { padding: 3px 0 5px; border-top: 1px solid #323238; }.generation-group:first-child { border-top: 0; }.generation-group h4 { margin: 2px 7px 4px; color: #85858f; font: var(--text-micro)/var(--leading-ui) var(--font-code); font-weight: var(--weight-medium); text-transform: uppercase; letter-spacing: .04em; }
  .activity-row { min-height: 31px; padding: 3px 6px; display: grid; grid-template-columns: 14px minmax(0,1fr) auto; align-items: start; gap: 6px; color: #74747e; }
  .activity-row > :global(svg) { justify-self: center; margin-top: 5px; }
  .activity-row > span { min-width: 0; display: grid; gap: 1px; }
  .activity-row strong,.activity-row small { overflow-wrap: anywhere; white-space: normal; }
  .activity-row strong { color: #9a9aa3; font-size: var(--text-control); font-weight: var(--weight-normal); }
  .activity-row small { color: #72727b; font-size: var(--text-caption); line-height: var(--leading-ui); }
  .activity-row .note { color: #85858e; }
  .activity-row img { width: 50px; height: 32px; border: 1px solid #414149; border-radius: 4px; background: #1c1c1f; object-fit: contain; }
  .activity-row.active { color: #83bfd7; }
  .activity-row.active strong { color: #bdd9e4; }
  .activity-row.recovering { color: #d5a85d; }
  .activity-row.recovering strong,.activity-row.recovering small { color: #b99a68; }
  .activity-row.kept { color: #70b98c; }
  .activity-row.kept strong { color: #9fc9ae; }
</style>
