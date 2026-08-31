<script lang="ts">
  import { Check, Copy } from "phosphor-svelte";
  import MarkdownInline from "$lib/editor/MarkdownInline.svelte";

  let { text, skills = [] }: { text: string; skills?: string[] } = $props();
  let copied = $state("");

  type Block =
    | { type: "code"; language: string; value: string }
    | { type: "list"; ordered: boolean; items: string[] }
    | { type: "heading"; level: number; value: string }
    | { type: "paragraph"; value: string };

  function prose(value: string): Block[] {
    const blocks: Block[] = [];
    const lines = value.split("\n");
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ type: "paragraph", value: paragraph.join("\n").trim() });
      paragraph = [];
    };
    const flushList = () => {
      if (list) blocks.push({ type: "list", ...list });
      list = null;
    };
    for (const line of lines) {
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      const bullet = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph(); flushList();
        blocks.push({ type: "heading", level: heading[1].length, value: heading[2] });
      } else if (bullet) {
        flushParagraph();
        const ordered = /\d/.test(bullet[1]);
        if (!list || list.ordered !== ordered) flushList();
        list ??= { ordered, items: [] };
        list.items.push(bullet[2]);
      } else if (!line.trim()) {
        flushParagraph(); flushList();
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph(); flushList();
    return blocks;
  }

  const blocks = $derived.by(() => {
    const result: Block[] = [];
    const parts = text.split(/```/);
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const newline = part.indexOf("\n");
        result.push({
          type: "code",
          language: newline >= 0 ? part.slice(0, newline).trim() : "",
          value: newline >= 0 ? part.slice(newline + 1).replace(/\n$/, "") : part,
        });
      } else result.push(...prose(part));
    });
    return result;
  });

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    copied = value;
    setTimeout(() => { if (copied === value) copied = ""; }, 1300);
  }
</script>

<div class="markdown">
  {#each blocks as block}
    {#if block.type === "code"}
      <div class="code-block">
        <div><span>{block.language || "code"}</span><button aria-label="Copy code" onclick={() => copy(block.value)}>{#if copied === block.value}<Check size={12} />{:else}<Copy size={12} />{/if}</button></div>
        <pre><code>{block.value}</code></pre>
      </div>
    {:else if block.type === "list"}
      {#if block.ordered}<ol>{#each block.items as item}<li><MarkdownInline text={item} {skills} /></li>{/each}</ol>{:else}<ul>{#each block.items as item}<li><MarkdownInline text={item} {skills} /></li>{/each}</ul>{/if}
    {:else if block.type === "heading"}
      <p class="heading" class:h1={block.level === 1} class:h2={block.level === 2}><MarkdownInline text={block.value} {skills} /></p>
    {:else}
      <p><MarkdownInline text={block.value} {skills} /></p>
    {/if}
  {/each}
</div>

<style>
  .markdown { font-size: var(--text-emphasis); line-height: var(--leading-body); color: #e7e7e9; overflow-wrap: anywhere; }.markdown p { margin: 0 0 10px; white-space: pre-wrap; }.markdown p:last-child { margin-bottom: 0; }.heading { font-weight: var(--weight-bold); color: #fff; margin-top: 13px !important; }.heading.h1 { font-size: var(--text-title); }.heading.h2 { font-size: var(--text-heading); }
  ul,ol { margin: 6px 0 10px; padding-left: 19px; display: grid; gap: 4px; } li::marker { color: #8d8d96; }
  .code-block { margin: 10px 0; border: 1px solid #424248; border-radius: 7px; overflow: hidden; background: #18181a; }.code-block > div { height: 29px; padding: 0 5px 0 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #333338; color: #85858e; font-size: var(--text-small); text-transform: uppercase; letter-spacing: .05em; }.code-block button { width: 27px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: #999; display: grid; place-items: center; cursor: pointer; }.code-block button:hover { background: #303036; color: white; }
  pre { margin: 0; padding: 11px 12px 13px; max-height: 310px; overflow: auto; white-space: pre; color: #d7d7dc; font: var(--text-body)/var(--leading-body) var(--font-code); user-select: text; }
</style>
