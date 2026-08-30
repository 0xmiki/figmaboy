<script lang="ts">
  import {
    CaretDown as ChevronDown, WarningCircle as CircleAlert, FileCode as FileCode2,
    CircleNotch as LoaderCircle, TerminalWindow as TerminalSquare, Wrench,
  } from "phosphor-svelte";
  import { isToolItem, itemStatus, itemText, object, titleCase, type CodexItem, type ToolGroup } from "$lib/codex-protocol";
  let { group, label, expanded = false, onExpandedChange }: { group: ToolGroup; label?: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void } = $props();

  function toolLabel(item: CodexItem): string {
    if (item.type === "agentMessage") return "Agent update";
    if (item.type === "reasoning") return "Reasoning";
    if (item.type === "plan") return "Plan";
    if (item.type === "mcpToolCall") {
      const labels: Record<string, string> = {
        document_get: "Read document",
        editor_status: "Checked editor",
        design_capabilities: "Read design capabilities",
        types_get: "Read design contract",
        operations_apply: "Applied layer changes",
        frame_screenshot: "Captured frame preview",
        image_place: "Placed image",
        nodes_center: "Centered layers",
        nodes_set_border_radius: "Changed border radius",
        document_save: "Saved design",
        history_undo: "Undid design change",
        history_redo: "Redid design change",
      };
      return labels[String(item.tool)] ?? titleCase(String(item.tool ?? "Tool call"));
    }
    if (item.type === "commandExecution") return String(item.command ?? "Ran command");
    if (item.type === "fileChange") return "Changed files";
    if (item.type === "webSearch") return "Searched the web";
    return titleCase(item.type);
  }

  function icon(item: CodexItem) {
    if (item.type === "commandExecution") return TerminalSquare;
    if (item.type === "fileChange") return FileCode2;
    return Wrench;
  }

  function details(item: CodexItem): string {
    if (item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan") return itemText(item);
    if (item.type === "commandExecution") return String(item.aggregatedOutput ?? item.cwd ?? "");
    if (item.type === "fileChange" && Array.isArray(item.changes)) return item.changes.map((change) => `${object(change).kind ?? "update"} ${object(change).path ?? ""}`).join("\n");
    if (item.type === "mcpToolCall") return item.progress ? String(item.progress) : item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    return "";
  }
</script>

<details class="tool-group" class:turn-fold={Boolean(label)} open={expanded || group.status === "inProgress"} ontoggle={(event) => onExpandedChange?.(event.currentTarget.open)}>
  <summary>{#if group.status === "inProgress"}<LoaderCircle class="spin" size={13} />{:else if group.status === "failed"}<CircleAlert class="failed-icon" size={13} />{/if}<span>{label ?? group.summary}</span>{#if group.status === "inProgress" || group.status === "failed"}<small class:failed={group.status === "failed"}>{group.status === "inProgress" ? "Working" : "Failed"}</small>{/if}<ChevronDown size={12} /></summary>
  <div class="tool-list">{#if label}<p>{group.summary}</p>{/if}{#each group.items as item (item.id)}{@const Icon = icon(item)}<details class="tool-row"><summary>{#if isToolItem(item)}<Icon size={13} />{/if}<span>{toolLabel(item)}</span>{#if itemStatus(item) === "failed"}<small class="failed">Failed</small>{/if}<ChevronDown size={10} /></summary>{#if details(item)}<pre>{details(item)}</pre>{/if}</details>{/each}</div>
</details>

<style>
  .tool-group { border: 0; border-bottom: 1px solid #3a3a40; background: transparent; }.tool-group > summary { min-height: 30px; padding: 1px 4px; display: flex; align-items: center; gap: 7px; list-style: none; color: #94949e; cursor: pointer; }.tool-group > summary:hover { color: #e2e2e6; }.tool-group summary::-webkit-details-marker { display: none; }.tool-group > summary > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-body); line-height: var(--leading-ui); }.tool-group > summary > small { font-size: var(--text-small); }.tool-group > summary > small.failed,.tool-group > summary :global(.failed-icon),.tool-row small.failed { color: #f87171; }.tool-group > summary :global(svg:last-child),.tool-row > summary :global(svg:last-child) { transition: transform 150ms ease; }.tool-group[open] > summary :global(svg:last-child),.tool-row[open] > summary :global(svg:last-child) { transform: rotate(180deg); }.tool-group.turn-fold > summary { padding-top: 4px; padding-bottom: 4px; color: #8b8b95; }
  .tool-list { padding: 2px 0 7px 8px; }.tool-list > p { margin: 1px 6px 5px; color: #777781; font-size: var(--text-control); line-height: var(--leading-ui); }.tool-row { border-radius: 5px; background: transparent; }.tool-row > summary { min-height: 28px; padding: 0 6px; display: flex; align-items: center; gap: 7px; list-style: none; color: #898993; cursor: pointer; }.tool-row > summary:hover { background: #2d2d32; color: #d7d7dc; }.tool-row > summary > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-control); }.tool-row small { font-size: var(--text-caption); }.tool-row pre { max-height: 190px; margin: 0 4px 4px 26px; padding: 8px; overflow: auto; border-left: 1px solid #3b3b42; color: #b8b8c0; font: var(--text-small)/var(--leading-body) var(--font-code); white-space: pre-wrap; user-select: text; }:global(.spin) { transform-box: fill-box; transform-origin: center; will-change: transform; animation: tool-spin 750ms linear infinite; } @keyframes tool-spin { to { transform: rotate(360deg); } } @keyframes tool-pulse { 50% { opacity: .35; } } @media (prefers-reduced-motion: reduce) { :global(.spin) { animation: tool-pulse 1.1s ease-in-out infinite; } }
</style>
