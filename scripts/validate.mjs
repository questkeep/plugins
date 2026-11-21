// Validates every plugins/<id>/ entry against the contract (docs/PLUGIN_REGISTRY.md in the
// Questkeep repository). Dependency-free.
//
//   node scripts/validate.mjs            offline checks
//   node scripts/validate.mjs --online   also download new versions and check hash, size, plugin.json
//   node scripts/validate.mjs --online --all   ... for every version, not only new ones
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
export const KINDS = ["store", "extension", "theme"];
export const MAX_ICON_BYTES = 200 * 1024;
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
// The first Questkeep version that knows the permissions `filesystem`, `registry`, `launcher` and
// `login`. Older versions ignore them, so plugins using them must set minApp at least this high.
// Correct this if the release that ships them gets another number.
export const MIN_APP_BROAD = "0.7.0";
// Anyone can put content on these, so a plugin that can read the user's files or registry must not
// send data to them (matched as the host itself or any subdomain).
export const SHARED_HOSTING_DOMAINS = [
  "github.io",
  "githubusercontent.com",
  "pages.dev",
  "workers.dev",
  "netlify.app",
  "vercel.app",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "s3.amazonaws.com",
  "amazonaws.com",
  "blob.core.windows.net",
  "azurewebsites.net",
  "glitch.me",
  "repl.co",
  "ngrok.io",
  "trycloudflare.com",
  "dropboxusercontent.com",
  "drive.google.com",
];

const META_FIELDS = ["id", "name", "summary", "description", "author", "repository", "homepage", "license", "tags", "kinds"];
const META_REQUIRED = ["id", "name", "summary", "description", "author", "repository", "license", "kinds"];
const VERSION_FIELDS = ["version", "url", "sha256", "size", "apiVersion", "minApp", "released", "notes", "yanked"];
const VERSION_REQUIRED = ["version", "url", "sha256", "apiVersion", "minApp", "released"];
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === "string";

/** Compares two semver strings by precedence (build metadata ignored). */
export function compareSemver(a, b) {
  const pa = SEMVER_RE.exec(a);
  const pb = SEMVER_RE.exec(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const ra = pa[4];
  const rb = pb[4];
  if (ra === undefined && rb === undefined) return 0;
  if (ra === undefined) return 1;
  if (rb === undefined) return -1;
  const ia = ra.split(".");
  const ib = rb.split(".");
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const na = /^\d+$/.test(ia[i]);
    const nb = /^\d+$/.test(ib[i]);
    if (na && nb) {
      const d = Number(ia[i]) - Number(ib[i]);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (na) return -1;
    else if (nb) return 1;
    else if (ia[i] !== ib[i]) return ia[i] < ib[i] ? -1 : 1;
  }
  return 0;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function readJson(path, problems, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    problems.push(`${label}: file is missing`);
    return undefined;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    problems.push(`${label}: not valid JSON (${e.message})`);
    return undefined;
  }
}

/** Validates a meta object. Returns a list of messages (without file prefix). */
export function validateMeta(meta, id) {
  const out = [];
  if (!isObject(meta)) return ["must be a JSON object"];
  for (const k of Object.keys(meta)) if (!META_FIELDS.includes(k)) out.push(`unknown field "${k}"`);
  for (const k of META_REQUIRED) if (!(k in meta)) out.push(`missing required field "${k}"`);
  const str = (k, max) => {
    if (!(k in meta)) return;
    if (!isString(meta[k]) || meta[k].trim() === "") out.push(`"${k}" must be a non-empty string`);
    else if (max && meta[k].length > max) out.push(`"${k}" is ${meta[k].length} characters, at most ${max} allowed`);
  };
  if ("id" in meta && meta.id !== id) out.push(`"id" is ${JSON.stringify(meta.id)} but the folder is "${id}"`);
  str("name", 64);
  str("summary", 120);
  str("description", 2000);
  str("author", 100);
  str("license", 64);
  if ("summary" in meta && isString(meta.summary) && /[\r\n]/.test(meta.summary)) out.push(`"summary" must be a single line`);
  if ("repository" in meta && !(isString(meta.repository) && REPO_RE.test(meta.repository)))
    out.push(`"repository" must be an https://github.com/<owner>/<repo> URL`);
  if ("homepage" in meta && meta.homepage !== undefined) {
    let ok = false;
    if (isString(meta.homepage)) {
      try {
        ok = new URL(meta.homepage).protocol === "https:";
      } catch {
        ok = false;
      }
    }
    if (!ok) out.push(`"homepage" must be an https:// URL`);
  }
  if ("tags" in meta) {
    if (!Array.isArray(meta.tags)) out.push(`"tags" must be an array of strings`);
    else {
      for (const t of meta.tags)
        if (!isString(t) || t === "" || t !== t.toLowerCase() || t.length > 32 || /\s/.test(t))
          out.push(`tag ${JSON.stringify(t)} must be a lowercase string without spaces (at most 32 characters)`);
      if (new Set(meta.tags).size !== meta.tags.length) out.push(`"tags" contains duplicates`);
    }
  }
  if ("kinds" in meta) {
    if (!Array.isArray(meta.kinds) || meta.kinds.length === 0) out.push(`"kinds" must be a non-empty array`);
    else {
      for (const k of meta.kinds) if (!KINDS.includes(k)) out.push(`kind ${JSON.stringify(k)} is not one of ${KINDS.join(", ")}`);
      if (new Set(meta.kinds).size !== meta.kinds.length) out.push(`"kinds" contains duplicates`);
    }
  }
  return out;
}

/** Validates a versions array. `repository` is meta.repository (may be undefined). */
export function validateVersions(versions, repository) {
  const out = [];
  if (!Array.isArray(versions)) return ["must be a JSON array"];
  const repoMatch = isString(repository) ? REPO_RE.exec(repository) : null;
  const seen = new Set();
  let prev;
  versions.forEach((v, i) => {
    const at = `[${i}]`;
    if (!isObject(v)) {
      out.push(`${at} must be an object`);
      return;
    }
    for (const k of Object.keys(v)) if (!VERSION_FIELDS.includes(k)) out.push(`${at} unknown field "${k}"`);
    for (const k of VERSION_REQUIRED) if (!(k in v)) out.push(`${at} missing required field "${k}"`);
    if ("version" in v) {
      if (!isString(v.version) || !SEMVER_RE.test(v.version)) out.push(`${at} "version" must be semver`);
      else {
        if (seen.has(v.version)) out.push(`${at} duplicate version ${v.version}`);
        seen.add(v.version);
        if (prev !== undefined && compareSemver(prev, v.version) >= 0 && prev !== v.version)
          out.push(`${at} version ${v.version} is not higher than the one before (${prev}); list versions in ascending order`);
        prev = v.version;
      }
    }
    if ("url" in v) {
      let url;
      try {
        url = new URL(v.url);
      } catch {
        url = undefined;
      }
      if (!isString(v.url) || !url || url.protocol !== "https:") out.push(`${at} "url" must be an https:// URL`);
      else {
        const m = /^\/([^/]+)\/([^/]+)\/releases\/download\/.+/.exec(url.pathname);
        if (url.hostname !== "github.com" || !m) out.push(`${at} "url" must be a github.com/<owner>/<repo>/releases/download/... URL`);
        else if (repoMatch && (m[1].toLowerCase() !== repoMatch[1].toLowerCase() || m[2].toLowerCase() !== repoMatch[2].toLowerCase()))
          out.push(`${at} "url" points at ${m[1]}/${m[2]}, but the repository is ${repoMatch[1]}/${repoMatch[2]}`);
      }
    }
    if ("sha256" in v && !(isString(v.sha256) && /^[0-9a-f]{64}$/.test(v.sha256)))
      out.push(`${at} "sha256" must be 64 lowercase hex characters`);
    if ("size" in v && !(Number.isInteger(v.size) && v.size > 0)) out.push(`${at} "size" must be a positive integer`);
    if ("apiVersion" in v && !(Number.isInteger(v.apiVersion) && v.apiVersion > 0)) out.push(`${at} "apiVersion" must be a positive integer`);
    if ("minApp" in v && !(isString(v.minApp) && SEMVER_RE.test(v.minApp))) out.push(`${at} "minApp" must be semver`);
    if ("released" in v && !(isString(v.released) && isRealDate(v.released))) out.push(`${at} "released" must be a date as YYYY-MM-DD`);
    if ("notes" in v && !isString(v.notes)) out.push(`${at} "notes" must be a string`);
    if ("yanked" in v && typeof v.yanked !== "boolean") out.push(`${at} "yanked" must be a boolean`);
  });
  return out;
}

/** Checks an icon file's content. Returns messages. */
export function validateIcon(name, buf) {
  const out = [];
  if (buf.length > MAX_ICON_BYTES) out.push(`${name} is ${buf.length} bytes, at most ${MAX_ICON_BYTES} allowed`);
  if (name.endsWith(".svg")) {
    const text = buf.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) out.push(`${name} is not an SVG`);
    if (/<script/i.test(text)) out.push(`${name} must not contain <script`);
    if (/[\s"'/]on[a-z]+\s*=/i.test(text)) out.push(`${name} must not contain event handler attributes (on*=)`);
    if (/javascript:/i.test(text)) out.push(`${name} must not contain javascript: URLs`);
  } else if (name.endsWith(".png")) {
    if (buf.length < 8 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      out.push(`${name} is not a PNG file`);
    else if (buf.length >= 24) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 256 || h > 256) out.push(`${name} is ${w}x${h}, at most 256x256 allowed`);
      if (w !== h) out.push(`${name} must be square (is ${w}x${h})`);
    }
  }
  return out;
}

/**
 * Validates plugins/<id> under `root`. Returns { problems: string[], meta, versions } where each
 * problem is already formatted as `plugins/<id>/<file>: message`.
 */
export function validatePlugin(root, id) {
  const problems = [];
  const dir = join(root, "plugins", id);
  const add = (file, msgs) => msgs.forEach((m) => problems.push(`plugins/${id}/${file}: ${m}`));
  if (!ID_RE.test(id)) add("", [`folder name is not a valid id (2-64 lowercase letters, digits and dashes, not starting with a dash)`]);

  const raw = [];
  const meta = readJson(join(dir, "meta.json"), raw, "meta.json");
  raw.forEach((m) => problems.push(`plugins/${id}/${m}`));
  if (meta !== undefined) add("meta.json", validateMeta(meta, id));

  const icons = ["icon.svg", "icon.png"].filter((f) => existsSync(join(dir, f)));
  if (icons.length === 0) add("icon", ["needs an icon.svg or icon.png"]);
  else if (icons.length > 1) add("icon", ["has both icon.svg and icon.png; keep exactly one"]);
  for (const f of icons) add(f, validateIcon(f, readFileSync(join(dir, f))));

  const raw2 = [];
  const versions = readJson(join(dir, "versions.json"), raw2, "versions.json");
  raw2.forEach((m) => problems.push(`plugins/${id}/${m}`));
  if (versions !== undefined) add("versions.json", validateVersions(versions, isObject(meta) ? meta.repository : undefined));

  return { problems, meta, versions };
}

/** Lists plugin folder names under root/plugins (ignores files such as .gitkeep). */
export function listPluginIds(root) {
  const dir = join(root, "plugins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function validateAll(root) {
  const problems = [];
  const plugins = [];
  const dir = join(root, "plugins");
  if (existsSync(dir))
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (!e.isDirectory() && e.name !== ".gitkeep") problems.push(`plugins/${e.name}: unexpected file (only plugin folders belong here)`);
  for (const id of listPluginIds(root)) {
    const r = validatePlugin(root, id);
    problems.push(...r.problems);
    plugins.push({ id, ...r });
  }
  return { problems, plugins };
}

// ---------------------------------------------------------------------------------------------
// Online checks

let zipTool;
/** "unzip", "tar" or null. */
export function detectZipTool() {
  if (zipTool !== undefined) return zipTool;
  const r = spawnSync("unzip", ["-v"], { stdio: "ignore", timeout: 10000 });
  if (!r.error) return (zipTool = "unzip");
  const t = spawnSync("tar", ["--version"], { stdio: "ignore", timeout: 10000 });
  return (zipTool = t.error ? null : "tar");
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
  if (r.error || r.status !== 0) return undefined;
  return r.stdout;
}

/** Lists entry names of a zip, or undefined if the tool cannot. */
export function listZip(zipPath) {
  const tool = detectZipTool();
  const out = tool === "unzip" ? run("unzip", ["-Z1", zipPath]) : tool === "tar" ? run("tar", ["-tf", zipPath]) : undefined;
  return out?.toString("utf8").split(/\r?\n/).filter(Boolean);
}

/** Reads one entry of a zip as a Buffer, or undefined. */
export function readZipEntry(zipPath, entry) {
  const tool = detectZipTool();
  if (tool === "unzip") return run("unzip", ["-p", zipPath, entry]);
  if (tool === "tar") return run("tar", ["-xOf", zipPath, entry]);
  return undefined;
}

/** Finds plugin.json at the zip's top or in its only top-level folder. Returns a path or undefined. */
export function findPluginJson(names) {
  // Zips made by old Windows tools use backslashes; match on a normalized name, return the original.
  const norm = names.map((n) => n.replaceAll("\\", "/"));
  const pick = (wanted) => {
    const i = norm.indexOf(wanted);
    return i === -1 ? undefined : names[i];
  };
  const top = pick("plugin.json");
  if (top) return top;
  const tops = new Set(norm.map((n) => n.split("/")[0]));
  if (tops.size === 1) return pick(`${[...tops][0]}/plugin.json`);
  return undefined;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`file is larger than ${MAX_DOWNLOAD_BYTES} bytes`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_DOWNLOAD_BYTES) throw new Error(`file is larger than ${MAX_DOWNLOAD_BYTES} bytes`);
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  writeFileSync(dest, buf);
  return buf;
}

/** Host part of a `permissions.http` / `login.domains` entry (scheme, port and path removed, lowercase). */
function hostOf(entry) {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

/**
 * Checks the permissions of a manifest read from a release zip against the registry rules.
 * `entry` is the versions.json entry (for minApp). Returns { errors, warnings } (messages).
 */
export function checkManifestPermissions(manifest, entry) {
  const errors = [];
  const warnings = [];
  const perms = isObject(manifest?.permissions) ? manifest.permissions : {};
  const broadRead = perms.filesystem !== undefined || perms.registry !== undefined;
  if (broadRead) {
    const hosts = [];
    if (Array.isArray(perms.http)) for (const h of perms.http) if (isString(h)) hosts.push(["permissions.http", h]);
    const domains = isObject(perms.login) && Array.isArray(perms.login.domains) ? perms.login.domains : [];
    for (const d of domains) if (isString(d)) hosts.push(["permissions.login.domains", d]);
    for (const [where, h] of hosts) {
      const host = hostOf(h);
      if (host.startsWith("*.") || host.includes("*"))
        errors.push(`${where} entry ${JSON.stringify(h)} is a wildcard; a plugin with filesystem or registry access must list exact hosts`);
      else if (SHARED_HOSTING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)))
        errors.push(`${where} entry ${JSON.stringify(h)} is a shared-hosting domain; a plugin with filesystem or registry access must not send data there`);
      if (/^http:\/\//i.test(h.trim())) warnings.push(`${where} entry ${JSON.stringify(h)} uses http://, which needs a stated reason in the pull request`);
    }
  }
  const usesNew = broadRead || perms.launcher !== undefined || perms.login !== undefined;
  if (usesNew) {
    const min = entry?.minApp;
    if (!isString(min) || !SEMVER_RE.test(min))
      errors.push(`plugin.json uses filesystem, registry, launcher or login, so the entry needs "minApp" of at least ${MIN_APP_BROAD}`);
    else if (compareSemver(min, MIN_APP_BROAD) < 0)
      errors.push(`"minApp" is ${min}, but filesystem, registry, launcher and login need at least ${MIN_APP_BROAD}`);
  }
  return { errors, warnings };
}

/** Checks one version entry against its downloaded zip. Returns messages. */
export async function checkVersionOnline(id, entry, workDir) {
  const out = [];
  const zip = join(workDir, `${id}-${entry.version}.zip`);
  let buf;
  try {
    buf = await download(entry.url, zip);
  } catch (e) {
    return [`${entry.version}: ${e.message}`];
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== entry.sha256) out.push(`${entry.version}: sha256 is ${entry.sha256} but the download hashes to ${sha}`);
  if (entry.size !== undefined && entry.size !== buf.length) out.push(`${entry.version}: size is ${entry.size} but the download has ${buf.length} bytes`);
  if (detectZipTool() === null) {
    console.warn(`warning: neither unzip nor tar found, skipping plugin.json check for ${id} ${entry.version}`);
    return out;
  }
  const names = listZip(zip);
  if (!names) return [...out, `${entry.version}: cannot read the zip file`];
  const path = findPluginJson(names);
  if (!path) return [...out, `${entry.version}: zip has no plugin.json at its top or in its only top-level folder`];
  const data = readZipEntry(zip, path);
  if (!data) return [...out, `${entry.version}: cannot read ${path} from the zip (entry names must use forward slashes)`];
  let manifest;
  try {
    manifest = JSON.parse(data.toString("utf8").replace(/^﻿/, ""));
  } catch {
    return [...out, `${entry.version}: plugin.json in the zip is not valid JSON`];
  }
  if (manifest.id !== id) out.push(`${entry.version}: plugin.json id is ${JSON.stringify(manifest.id)}, expected "${id}"`);
  if (manifest.version !== entry.version) out.push(`${entry.version}: plugin.json version is ${JSON.stringify(manifest.version)}`);
  if (manifest.apiVersion !== entry.apiVersion)
    out.push(`${entry.version}: plugin.json apiVersion is ${JSON.stringify(manifest.apiVersion)}, entry says ${entry.apiVersion}`);
  const perm = checkManifestPermissions(manifest, entry);
  out.push(...perm.errors.map((m) => `${entry.version}: ${m}`));
  for (const w of perm.warnings) console.warn(`warning: plugins/${id}/versions.json: ${entry.version}: ${w}`);
  return out;
}

function gitShow(root, path) {
  try {
    return execFileSync("git", ["show", `origin/main:${path}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Versions of `versions` that are not in origin/main's copy (all when that is missing). */
export function newVersions(root, id, versions, all) {
  if (all) return versions;
  const text = gitShow(root, `plugins/${id}/versions.json`);
  if (text === undefined) return versions;
  let old;
  try {
    old = JSON.parse(text);
  } catch {
    return versions;
  }
  const known = new Map(Array.isArray(old) ? old.map((o) => [o?.version, o]) : []);
  // An entry whose url or hash changed counts as new as well.
  return versions.filter((v) => {
    const o = known.get(v.version);
    return !o || o.url !== v.url || o.sha256 !== v.sha256;
  });
}

export async function validateOnline(root, plugins, all) {
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "qk-registry-"));
  try {
    for (const p of plugins) {
      if (!Array.isArray(p.versions)) continue;
      const valid = p.versions.filter((v) => isObject(v) && isString(v.url) && isString(v.version));
      for (const v of newVersions(root, p.id, valid, all)) {
        console.log(`checking ${p.id} ${v.version} ...`);
        const msgs = await checkVersionOnline(p.id, v, work);
        msgs.forEach((m) => problems.push(`plugins/${p.id}/versions.json: ${m}`));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { problems, plugins } = validateAll(root);
  if (args.includes("--online")) {
    // Only entries that passed the offline checks are downloaded.
    const clean = plugins.filter((p) => p.problems.length === 0);
    problems.push(...(await validateOnline(root, clean, args.includes("--all"))));
  }
  for (const p of problems) console.error(p);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) found.`);
    process.exit(1);
  }
  console.log(`OK: ${plugins.length} plugin(s) valid.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
