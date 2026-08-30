import type { DesignNode, PageDocument } from "$lib/domain";

/** Return the rendered ancestry from the root down to the hit node. */
export function canvasNodeChain(document: PageDocument, hitId: string): string[] {
  const reversed: string[] = [];
  const seen = new Set<string>();
  let id: string | null = hitId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node: DesignNode | undefined = document.nodes[id];
    if (!node) return [];
    reversed.push(id);
    id = node.parentId;
  }
  const chain = reversed.reverse();
  // Descendants of a hidden container are not canvas-selectable even if their
  // own visible flag is true.
  if (chain.some((candidate) => !document.nodes[candidate]?.visible)) return [];
  return chain;
}

export function isCanvasNodeVisible(document: PageDocument, id: string): boolean {
  return canvasNodeChain(document, id).length > 0;
}

export function isCanvasNodeSelectable(document: PageDocument, id: string): boolean {
  const chain = canvasNodeChain(document, id);
  return chain.length > 0 && chain.every((candidate) => !document.nodes[candidate]?.locked);
}

/**
 * Resolve a visual hit to Figma-style selection depth.
 *
 * An ordinary click selects the outermost parent. Double-clicking moves down
 * one level at a time. Once a level has been entered, sibling clicks stay at
 * that level. Modifier-click deep-selects the rendered leaf directly.
 */
export function canvasSelectionTarget(
  document: PageDocument,
  hitId: string,
  selectedIds: string[],
  deepSelect = false,
  descendOneLevel = false,
): string | null {
  const chain = canvasNodeChain(document, hitId);
  if (!chain.length || chain.some((id) => document.nodes[id]?.locked)) return null;
  if (deepSelect) return chain.at(-1) ?? null;

  const selectedOnHitIndex = chain.findLastIndex((id) => selectedIds.includes(id));
  if (selectedOnHitIndex >= 0) {
    return descendOneLevel ? chain[selectedOnHitIndex + 1] ?? chain[selectedOnHitIndex] : chain[selectedOnHitIndex];
  }

  if (selectedIds.length) {
    const selectedChains = selectedIds.map((id) => new Set(
      canvasNodeChain(document, id),
    ));
    const sharedScopeIndex = chain.findLastIndex((id) => {
      const node = document.nodes[id];
      return (node?.type === "frame" || node?.type === "group")
        && selectedChains.every((selectedChain) => selectedChain.has(id));
    });
    if (sharedScopeIndex >= 0) return chain[sharedScopeIndex + 1] ?? chain[sharedScopeIndex];
  }

  return chain[0];
}
