import icons from "@iconify-json/lucide/icons.json";

interface IconifyEntry { body: string; width?: number; height?: number }
const catalog = icons.icons as Record<string, IconifyEntry>;
export const iconNames = Object.keys(catalog).sort();

export function iconData(name: string): { body: string; width: number; height: number } | null {
  const icon = catalog[name];
  if (!icon) return null;
  return { body: icon.body, width: icon.width ?? 24, height: icon.height ?? 24 };
}

export function searchIcons(query: string, limit = 120): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return iconNames.slice(0, limit);
  const words = normalized.split(/\s+/);
  return iconNames.filter((name) => words.every((word) => name.includes(word))).slice(0, limit);
}
