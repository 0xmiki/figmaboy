<script lang="ts">
  let { text, skills = [] }: { text: string; skills?: string[] } = $props();
  type Part = { type: "text" | "code" | "skill"; value: string; name?: string };

  function label(name: string): string {
    return name.split(/[-_]+/).map((part) => part.toLowerCase() === "ui" ? "UI" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
  }

  const parts = $derived.by(() => {
    const result: Part[] = [];
    const available = new Set(skills);
    const pattern = /`([^`\n]+)`|\$([A-Za-z0-9][A-Za-z0-9_-]*)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > cursor) result.push({ type: "text", value: text.slice(cursor, start) });
      if (match[1] !== undefined) result.push({ type: "code", value: match[1] });
      else if (match[2] && available.has(match[2])) result.push({ type: "skill", value: match[0], name: match[2] });
      else result.push({ type: "text", value: match[0] });
      cursor = start + match[0].length;
    }
    if (cursor < text.length) result.push({ type: "text", value: text.slice(cursor) });
    return result;
  });
</script>

{#each parts as part}
  {#if part.type === "skill" && part.name}<span class="inline-skill" data-markdown-copy={part.value}>{label(part.name)}</span>{:else if part.type === "code"}<code>{part.value}</code>{:else}{part.value}{/if}
{/each}

<style>
  .inline-skill { display: inline-flex; align-items: center; gap: 4px; margin: 0 1px; padding: 1px 5px 1px 4px; border: 1px solid #31566a; border-radius: 5px; background: #233740; color: #9fddf2; font-size: .92em; font-weight: var(--weight-medium); line-height: 1.35; vertical-align: baseline; white-space: nowrap; }
  code { padding: 1px 4px; border-radius: 4px; background: #ffffff0c; color: #d6d6dc; font-family: var(--font-code); font-size: .92em; }
</style>
