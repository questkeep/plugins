import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildIndex, mapPlugin, mapVersion, sortPlugins, writeSite } from "./build-index.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/good", import.meta.url));
const NOW = "2026-11-20T12:00:00Z";

function withTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), "qk-idx-test-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const META = { id: "x1", name: "X", summary: "s", description: "d", author: "a", repository: "r", license: "MIT", kinds: ["theme"] };

test("zero plugins gives an empty list and a site", () =>
  withTemp((root) => {
    assert.deepEqual(buildIndex(root, NOW), { schema: 1, generated: NOW, plugins: [] });
    const out = join(root, "site");
    writeSite(root, out, NOW);
    assert.ok(existsSync(join(out, "index.html")));
    assert.ok(existsSync(join(out, "icons")));
    assert.deepEqual(JSON.parse(readFileSync(join(out, "index.json"), "utf8")).plugins, []);
  }));

test("plugins are sorted by name, case-insensitively", () => {
  const sorted = sortPlugins([
    { id: "z", name: "Zebra" },
    { id: "b", name: "banana" },
    { id: "a", name: "Apple" },
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ["a", "b", "z"]);
});

test("field mapping fills optional fields", () => {
  const v = mapVersion({ version: "1.0.0", url: "u", sha256: "h", apiVersion: 1, minApp: "0.7.0", released: "2026-11-20" });
  assert.deepEqual(v, { version: "1.0.0", url: "u", sha256: "h", size: null, apiVersion: 1, minApp: "0.7.0", released: "2026-11-20", notes: null, yanked: false });
  const p = mapPlugin(META, [], "icons/x1.svg");
  assert.equal(p.homepage, null);
  assert.deepEqual(p.tags, []);
  assert.deepEqual(Object.keys(p), ["id", "name", "summary", "description", "author", "repository", "homepage", "license", "tags", "kinds", "icon", "versions"]);
});

test("index from the fixture", () =>
  withTemp((root) => {
    cpSync(FIXTURE, root, { recursive: true });
    const index = buildIndex(root, NOW);
    assert.equal(index.schema, 1);
    assert.equal(index.generated, NOW);
    assert.deepEqual(index.plugins.map((x) => x.id), ["alpha", "demo-store"]);
    const [alpha, demo] = index.plugins;
    assert.equal(alpha.icon, "icons/alpha.png");
    assert.equal(demo.icon, "icons/demo-store.svg");
    assert.deepEqual(demo.versions.map((v) => v.version), ["0.1.0", "0.2.0"]);
    assert.equal(demo.versions[0].yanked, true);
    assert.equal(demo.versions[0].size, 1234);
    assert.equal(demo.versions[1].size, null);
    assert.equal(demo.versions[1].notes, null);
    assert.equal(demo.versions[1].yanked, false);
    assert.equal(alpha.homepage, null);
    assert.deepEqual(alpha.versions, []);
  }));

test("versions are sorted ascending by semver, not by text", () => {
  const base = { url: "u", sha256: "h", apiVersion: 1, minApp: "0.7.0", released: "2026-11-20" };
  const p = mapPlugin(META, [{ ...base, version: "0.10.0" }, { ...base, version: "0.9.0" }], "icons/x1.svg");
  assert.deepEqual(p.versions.map((v) => v.version), ["0.9.0", "0.10.0"]);
});

test("writeSite copies icons and replaces an old site", () =>
  withTemp((root) => {
    cpSync(FIXTURE, root, { recursive: true });
    mkdirSync(join(root, "site"), { recursive: true });
    writeSite(root, join(root, "site"), NOW);
    assert.ok(existsSync(join(root, "site/icons/alpha.png")));
    assert.ok(existsSync(join(root, "site/icons/demo-store.svg")));
    assert.ok(readFileSync(join(root, "site/index.html"), "utf8").includes("index.json"));
  }));
