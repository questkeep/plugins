import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MIN_APP_BROAD, checkManifestPermissions, compareSemver, findPluginJson, validateAll, validateIcon, validateMeta, validateVersions } from "./validate.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/good", import.meta.url));

/** Copies the good fixture to a temp dir, lets `edit(root)` change it, returns the problems. */
function problemsAfter(edit) {
  const root = mkdtempSync(join(tmpdir(), "qk-reg-test-"));
  try {
    cpSync(FIXTURE, root, { recursive: true });
    edit?.(root);
    return validateAll(root).problems;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const p = (root, ...parts) => join(root, "plugins", "demo-store", ...parts);
const editJson = (path, fn) => writeFileSync(path, JSON.stringify(fn(JSON.parse(readFileSync(path, "utf8")))));
const hasProblem = (problems, needle) => problems.some((x) => x.includes(needle));

test("good fixture has no problems", () => {
  assert.deepEqual(problemsAfter(), []);
});

test("zero plugins is fine", () => {
  const root = mkdtempSync(join(tmpdir(), "qk-reg-test-"));
  try {
    assert.deepEqual(validateAll(root).problems, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("problems are prefixed with plugins/<id>/<file>", () => {
  const problems = problemsAfter((r) => editJson(p(r, "meta.json"), (m) => ({ ...m, license: "" })));
  assert.ok(problems.some((x) => x.startsWith("plugins/demo-store/meta.json: ")));
});

test("id must match folder and be valid", () => {
  assert.ok(hasProblem(problemsAfter((r) => editJson(p(r, "meta.json"), (m) => ({ ...m, id: "other" }))), "but the folder is"));
  const bad = problemsAfter((r) => cpSync(p(r), join(r, "plugins", "-bad"), { recursive: true }));
  assert.ok(hasProblem(bad, "plugins/-bad/: folder name is not a valid id"));
  const upper = problemsAfter((r) => cpSync(p(r), join(r, "plugins", "Upper"), { recursive: true }));
  assert.ok(hasProblem(upper, "not a valid id"));
});

test("meta field errors", () => {
  const meta = JSON.parse(readFileSync(join(FIXTURE, "plugins/demo-store/meta.json"), "utf8"));
  const check = (patch, needle) => assert.ok(hasProblem(validateMeta({ ...meta, ...patch }, "demo-store"), needle), needle);
  check({ summary: "x".repeat(121) }, '"summary" is 121');
  check({ description: "x".repeat(2001) }, '"description" is 2001');
  check({ kinds: [] }, "non-empty array");
  check({ kinds: ["store", "game"] }, 'kind "game"');
  check({ repository: "https://gitlab.com/a/b" }, "repository");
  check({ repository: "https://github.com/a/b/c" }, "repository");
  check({ homepage: "http://example.com" }, "homepage");
  check({ tags: ["Store"] }, "lowercase");
  check({ tags: "store" }, "array of strings");
  check({ name: 5 }, "non-empty string");
  check({ colour: "red" }, 'unknown field "colour"');
  const { name, ...noName } = meta;
  assert.ok(hasProblem(validateMeta(noName, "demo-store"), 'missing required field "name"'));
  const { homepage, tags, ...optionalGone } = meta;
  assert.deepEqual(validateMeta(optionalGone, "demo-store"), []);
});

test("versions.json errors", () => {
  const good = JSON.parse(readFileSync(join(FIXTURE, "plugins/demo-store/versions.json"), "utf8"));
  const repo = "https://github.com/example/plugin-demo-store";
  assert.deepEqual(validateVersions(good, repo), []);
  const patched = (patch, i = 1) => good.map((v, j) => (j === i ? { ...v, ...patch } : v));
  const check = (versions, needle) => assert.ok(hasProblem(validateVersions(versions, repo), needle), needle);
  check({}, "must be a JSON array");
  check(patched({ version: "1.0" }), "must be semver");
  check(patched({ version: "0.1.0" }), "duplicate version");
  check([good[1], good[0]], "ascending order");
  check(patched({ url: "http://github.com/example/plugin-demo-store/releases/download/v/x.zip" }), "https");
  check(patched({ url: "https://example.com/x.zip" }), "releases/download");
  check(patched({ url: "https://github.com/other/repo/releases/download/v1/x.zip" }), "but the repository is");
  check(patched({ sha256: "abc" }), "64 lowercase hex");
  check(patched({ sha256: "A".repeat(64) }), "64 lowercase hex");
  check(patched({ size: 0 }), "positive integer");
  check(patched({ size: 1.5 }), "positive integer");
  check(patched({ apiVersion: "1" }), "apiVersion");
  check(patched({ minApp: "latest" }), "minApp");
  check(patched({ released: "2026-02-30" }), "YYYY-MM-DD");
  check(patched({ released: "20.11.2026" }), "YYYY-MM-DD");
  check(patched({ notes: 5 }), "notes");
  check(patched({ yanked: "no" }), "yanked");
  check(patched({ yankd: true }), 'unknown field "yankd"');
  check([{ version: "1.0.0" }], 'missing required field "url"');
});

test("semver ordering", () => {
  assert.equal(compareSemver("0.2.0", "0.10.0"), -1);
  assert.equal(compareSemver("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0+build"), 0);
  assert.equal(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
});

test("icon rules", () => {
  assert.ok(hasProblem(problemsAfter((r) => rmSync(p(r, "icon.svg"))), "needs an icon"));
  assert.ok(hasProblem(problemsAfter((r) => writeFileSync(p(r, "icon.png"), "x")), "keep exactly one"));
  const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  assert.deepEqual(validateIcon("icon.svg", svg("<rect/>")), []);
  assert.ok(hasProblem(validateIcon("icon.svg", svg("<script>1</script>")), "<script"));
  assert.ok(hasProblem(validateIcon("icon.svg", svg('<rect onload="x()"/>')), "event handler"));
  assert.ok(hasProblem(validateIcon("icon.svg", svg('<a href="javascript:x()"/>')), "javascript:"));
  assert.ok(hasProblem(validateIcon("icon.svg", Buffer.alloc(200 * 1024 + 1, "a")), "at most"));
  assert.ok(hasProblem(validateIcon("icon.png", Buffer.from("not a png")), "not a PNG"));
});

test("missing and broken files", () => {
  assert.ok(hasProblem(problemsAfter((r) => rmSync(p(r, "versions.json"))), "versions.json: file is missing"));
  assert.ok(hasProblem(problemsAfter((r) => writeFileSync(p(r, "meta.json"), "{")), "not valid JSON"));
  assert.ok(hasProblem(problemsAfter((r) => writeFileSync(join(r, "plugins", "stray.txt"), "x")), "unexpected file"));
});

test("plugin.json lookup in a zip listing", () => {
  assert.equal(findPluginJson(["plugin.json", "a.wasm"]), "plugin.json");
  assert.equal(findPluginJson(["demo/", "demo/plugin.json", "demo/a.wasm"]), "demo/plugin.json");
  assert.equal(findPluginJson(["a/plugin.json", "b/x"]), undefined);
  assert.equal(findPluginJson(["a/b/plugin.json", "a/x"]), undefined);
  assert.equal(findPluginJson(["demo\\plugin.json"]), "demo\\plugin.json");
});

test("broad access: hosts of a plugin with filesystem or registry", () => {
  const check = (permissions, minApp = MIN_APP_BROAD) => checkManifestPermissions({ permissions }, { minApp });
  const ok = check({ filesystem: "read", http: ["api.example.com"], login: { domains: ["example.com"] } });
  assert.deepEqual(ok, { errors: [], warnings: [] });
  for (const bad of ["*.example.com", "foo.github.io", "https://x.pages.dev/api", "bucket.s3.amazonaws.com", "a.b.workers.dev", "github.io"]) {
    const r = check({ registry: "read", http: [bad] });
    assert.ok(hasProblem(r.errors, JSON.stringify(bad)), bad);
  }
  assert.ok(hasProblem(check({ filesystem: "read", login: { domains: ["me.netlify.app"] } }).errors, "permissions.login.domains"));
  // googleapis.com is not a shared-hosting domain; lookalikes are fine
  assert.deepEqual(check({ filesystem: "read", http: ["www.googleapis.com", "notgithub.io.example.com", "mygithub.io"] }).errors, []);
  // without filesystem/registry the host rules do not apply
  assert.deepEqual(check({ http: ["foo.github.io", "*.example.com"] }).errors, []);
  const local = check({ filesystem: "read", http: ["http://localhost:8080"] });
  assert.deepEqual(local.errors, []);
  assert.ok(hasProblem(local.warnings, "needs a stated reason"));
});

test("broad access: minApp", () => {
  const check = (permissions, minApp) => checkManifestPermissions({ permissions }, { minApp }).errors;
  for (const perms of [{ filesystem: "read" }, { registry: "read" }, { launcher: { processNames: ["a.exe"] } }, { login: { title: "t", url: "https://x.example", domains: ["x.example"] } }]) {
    assert.ok(hasProblem(check(perms, undefined), "needs \"minApp\""));
    assert.ok(hasProblem(check(perms, "0.6.9"), "need at least 0.7.0"));
    assert.ok(hasProblem(check(perms, "0.7.0-rc.1"), "need at least"));
    assert.deepEqual(check(perms, "0.7.0"), []);
    assert.deepEqual(check(perms, "0.10.0"), []);
    assert.deepEqual(check(perms, "1.0.0"), []);
  }
  assert.deepEqual(check({ http: ["api.example.com"] }, "0.1.0"), []);
  assert.deepEqual(checkManifestPermissions({}, { minApp: "0.1.0" }), { errors: [], warnings: [] });
});
