<script lang="ts">
  import { ArrowClockwise, CaretDown, Check, Circle, X } from "phosphor-svelte";

  type Activity = {
    id: string;
    pass: number;
    title: string;
    detail: string;
    notes: string[];
    status: "working" | "complete" | "kept" | "discarded" | "recovering";
  };

  let { stage, stageLabel, pass, kept, discarded, activities }: {
    stage: string;
    stageLabel: string;
    pass: number;
    kept: number;
    discarded: number;
    activities: Activity[];
  } = $props();

  let open = $state(true);
  const steps = ["Review", "Design", "Apply", "Compare"];
  const activeStep = $derived(stage === "design" ? 1 : stage === "preview" ? 2 : stage === "compare" ? 3 : 0);
  const visibleActivities = $derived(activities.slice(-7));

  function ActivityIcon(status: Activity["status"]) {
    if (status === "recovering") return ArrowClockwise;
    if (status === "kept" || status === "complete") return Check;
    if (status === "discarded") return X;
    return Circle;
  }
</script>

<details class="evolve-work" bind:open>
  <summary>
    <span class="live-dot" aria-hidden="true"></span>
    <span class="summary-copy"><strong>Evolving design</strong><small>{stageLabel}</small></span>
    <span class="counts">Pass {Math.max(1, pass)} · {kept} kept · {discarded} discarded</span>
    <CaretDown size={12} />
  </summary>
  <div class="evolve-body">
    <div class="phase-rail" aria-label={`Current evolution step: ${steps[activeStep]}`}>
      {#each steps as step, index}
        <span class:active={index === activeStep} class:done={index < activeStep}>{index < activeStep ? "✓" : index + 1} {step}</span>
      {/each}
    </div>
    <div class="activity-list">
      {#if activities.length > visibleActivities.length}<p>{activities.length - visibleActivities.length} earlier steps</p>{/if}
      {#each visibleActivities as activity (activity.id)}
        {@const Icon = ActivityIcon(activity.status)}
        <div class:active={activity.status === "working"} class:recovering={activity.status === "recovering"} class:kept={activity.status === "kept"} class="activity-row">
          <Icon size={activity.status === "working" ? 7 : 12} weight={activity.status === "working" ? "fill" : "regular"} />
          <span title={activity.detail || activity.title}><strong>{activity.title}</strong>{#if activity.detail}<small>{activity.detail}</small>{/if}{#if activity.notes[0]}<small class="note">{activity.notes[0]}</small>{/if}</span>
        </div>
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
  .activity-list > p { margin: 2px 7px 4px; color: #686871; font-size: var(--text-caption); }
  .activity-row { min-height: 31px; padding: 3px 6px; display: grid; grid-template-columns: 14px minmax(0,1fr); align-items: start; gap: 6px; color: #74747e; }
  .activity-row > :global(svg) { justify-self: center; margin-top: 5px; }
  .activity-row > span { min-width: 0; display: grid; gap: 1px; }
  .activity-row strong,.activity-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .activity-row strong { color: #9a9aa3; font-size: var(--text-control); font-weight: var(--weight-normal); }
  .activity-row small { color: #72727b; font-size: var(--text-caption); line-height: var(--leading-ui); }
  .activity-row .note { color: #85858e; }
  .activity-row.active { color: #83bfd7; }
  .activity-row.active strong { color: #bdd9e4; }
  .activity-row.recovering { color: #d5a85d; }
  .activity-row.recovering strong,.activity-row.recovering small { color: #b99a68; }
  .activity-row.kept { color: #70b98c; }
  .activity-row.kept strong { color: #9fc9ae; }
</style>
