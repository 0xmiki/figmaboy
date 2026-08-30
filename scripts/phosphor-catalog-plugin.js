import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const moduleId = "virtual:phosphor-regular-icons";
const resolvedModuleId = `\0${moduleId}`;
const require = createRequire(import.meta.url);
const catalogPath = require.resolve("@iconify-json/ph/icons.json");
const weightVariant = /-(bold|duotone|fill|light|thin)$/;

/** @returns {import("vite").Plugin} */
export function phosphorCatalog() {
  return {
    name: "figmaboy-phosphor-catalog",
    resolveId(id) {
      return id === moduleId ? resolvedModuleId : null;
    },
    async load(id) {
      if (id !== resolvedModuleId) return null;
      const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
      const icons = Object.fromEntries(
        Object.entries(catalog.icons).filter(([name]) => !weightVariant.test(name)),
      );
      return `export default ${JSON.stringify({ icons, width: catalog.width, height: catalog.height })};`;
    },
  };
}
