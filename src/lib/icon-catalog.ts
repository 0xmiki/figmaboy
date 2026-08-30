import { get, writable } from "svelte/store";

interface IconifyEntry { body: string; width?: number; height?: number }
export type IconCatalog = { icons: Record<string, IconifyEntry>; names: string[]; width: number; height: number };
export const iconCatalog = writable<IconCatalog | null>(null);
let loadPromise: Promise<IconCatalog> | null = null;

export async function ensureIconCatalog(): Promise<IconCatalog> {
  const loaded = get(iconCatalog);
  if (loaded) return loaded;
  loadPromise ??= import("virtual:phosphor-regular-icons").then(({ default: source }) => {
    const catalog = { icons: source.icons, names: Object.keys(source.icons).sort(), width: source.width ?? 256, height: source.height ?? 256 };
    iconCatalog.set(catalog);
    return catalog;
  });
  return loadPromise;
}

export function availableIconNames(source = get(iconCatalog)): string[] {
  return source?.names ?? [];
}

export function iconData(name: string, source = get(iconCatalog)): { body: string; width: number; height: number } | null {
  const icon = source?.icons[name];
  if (!icon) return null;
  return { body: icon.body, width: icon.width ?? source?.width ?? 256, height: icon.height ?? source?.height ?? 256 };
}

export function searchIcons(query: string, limit = 120, source = get(iconCatalog)): string[] {
  const iconNames = availableIconNames(source);
  const normalized = query.trim().toLowerCase();
  if (!normalized) return iconNames.slice(0, limit);
  const words = normalized.split(/\s+/);
  return iconNames.filter((name) => words.every((word) => name.includes(word))).slice(0, limit);
}
