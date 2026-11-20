// Writes site/index.json (schema 1, see docs/PLUGIN_REGISTRY.md in the Questkeep repository),
// copies the icons to site/icons/ and writes a small site/index.html.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareSemver, listPluginIds } from "./validate.mjs";

export const SCHEMA = 1;

export function iconFile(root, id) {
  return ["svg", "png"].find((ext) => existsSync(join(root, "plugins", id, `icon.${ext}`)));
}

export function mapVersion(v) {
  return {
    version: v.version,
    url: v.url,
    sha256: v.sha256,
    size: v.size ?? null,
    apiVersion: v.apiVersion,
    minApp: v.minApp,
    released: v.released,
    notes: v.notes ?? null,
    yanked: v.yanked ?? false,
  };
}

export function mapPlugin(meta, versions, icon) {
  return {
    id: meta.id,
    name: meta.name,
    summary: meta.summary,
    description: meta.description,
    author: meta.author,
    repository: meta.repository,
    homepage: meta.homepage ?? null,
    license: meta.license,
    tags: meta.tags ?? [],
    kinds: meta.kinds,
    icon,
    versions: [...versions].sort((a, b) => compareSemver(a.version, b.version)).map(mapVersion),
  };
}

export function sortPlugins(plugins) {
  return [...plugins].sort((a, b) => {
    const c = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en");
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}

/** Builds the index object for the plugins under `root`. */
export function buildIndex(root, generated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")) {
  const plugins = listPluginIds(root).map((id) => {
    const dir = join(root, "plugins", id);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    const versions = JSON.parse(readFileSync(join(dir, "versions.json"), "utf8"));
    const ext = iconFile(root, id);
    if (!ext) throw new Error(`plugins/${id}: no icon`);
    return mapPlugin(meta, versions, `icons/${id}.${ext}`);
  });
  return { schema: SCHEMA, generated, plugins: sortPlugins(plugins) };
}

export function indexHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Questkeep plugin registry</title>
</head>
<body>
<h1>Questkeep plugin registry</h1>
<p>This is the plugin index that Questkeep reads: <a href="index.json">index.json</a>.</p>
<p>Source and how to submit a plugin: <a href="https://github.com/questkeep/plugins">github.com/questkeep/plugins</a>.</p>
</body>
</html>
`;
}

/** Writes the site into `outDir` (replacing it). Returns the index. */
export function writeSite(root, outDir, generated) {
  const index = buildIndex(root, generated);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "icons"), { recursive: true });
  for (const p of index.plugins) copyFileSync(join(root, "plugins", p.id, `icon.${p.icon.split(".").pop()}`), join(outDir, p.icon));
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  writeFileSync(join(outDir, "index.html"), indexHtml());
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const index = writeSite(root, join(root, "site"));
  console.log(`site/index.json written: ${index.plugins.length} plugin(s).`);
}
