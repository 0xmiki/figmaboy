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

/**
 * Resolve a visual hit to Figma-style selection depth.
 *
 * The outermost unlocked boundary wins initially. Once that boundary is
 * selected, the next click skips structural frames and jumps to the nearest
 * group (groups remain atomic) or otherwise the actual leaf under the cursor.
 * Selecting one child also establishes its parent as the scope for sibling
 * clicks. Locked ancestors are skipped without blocking unlocked descendants.
 */
export function canvasSelectionTarget(
  document: PageDocument,
  hitId: string,
  selectedIds: string[],
  deepSelect = false,
): string | null {
  const chain = canvasNodeChain(document, hitId).filter((id) => !document.nodes[id]?.locked);
  if (!chain.length) return null;
  if (deepSelect) return chain.at(-1) ?? null;

  const targetInside = (scopeIndex: number) => {
    const descendants = chain.slice(scopeIndex + 1);
    if (!descendants.length) return chain[scopeIndex];
    return descendants.find((id) => document.nodes[id]?.type === "group") ?? descendants.at(-1) ?? chain[scopeIndex];
  };

  if (selectedIds.length) {
    // Selection inside a container establishes that container as an editing
    // scope. Keep the deepest frame/group shared by the current selection and
    // the new hit, so moving between sibling buttons does not bounce back to
    // their outer frame.
    const selectedChains = selectedIds.map((id) => new Set(
      canvasNodeChain(document, id).filter((candidate) => !document.nodes[candidate]?.locked),
    ));
    const sharedScopeIndex = chain.findLastIndex((id) => {
      const node = document.nodes[id];
      return (node?.type === "frame" || node?.type === "group")
        && selectedChains.every((selectedChain) => selectedChain.has(id));
    });
    if (sharedScopeIndex >= 0) return targetInside(sharedScopeIndex);
  }

  return chain[0];
}
