# Contributing a plugin

A plugin is listed by a pull request that adds a folder `plugins/<id>/`. `<id>` is the plugin's id
from its `plugin.json`: 2 to 64 lowercase letters, digits and dashes, not starting with a dash.

## Submit a new plugin

1. Release your plugin as a zip on a GitHub Release of your own **public** repository (see
   "Release zip rules").
2. Fork this repository and add:
   - `plugins/<id>/meta.json`
   - `plugins/<id>/icon.svg` (or `icon.png`, exactly one)
   - `plugins/<id>/versions.json` with your first version
3. Compute the hash of the exact file attached to the release:
   `sha256sum my-plugin-0.1.0.zip` (Linux, macOS, Git Bash) or
   `(Get-FileHash my-plugin-0.1.0.zip -Algorithm SHA256).Hash.ToLower()` (PowerShell).
4. Run `node scripts/validate.mjs --online` (Node 26). CI runs the same on your pull request.
5. Open the pull request and fill in the checklist.

### meta.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "summary": "One line, at most 120 characters.",
  "description": "A few sentences, plain text, at most 2000 characters.",
  "author": "Name",
  "repository": "https://github.com/<owner>/<repo>",
  "homepage": "https://optional.example",
  "license": "MIT",
  "tags": ["store"],
  "kinds": ["store"]
}
```

`kinds` is a non-empty list of `store`, `extension`, `theme`. `homepage` and `tags` are optional,
tags are lowercase. Unknown fields are errors.

### Icon

`icon.svg` (preferred) or `icon.png`: square, PNG at most 256x256, at most 200 KB. SVGs must not
contain scripts, event handler attributes (`on...=`) or `javascript:` URLs.

### versions.json

```json
[
  {
    "version": "0.1.0",
    "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.0/my-plugin-0.1.0.zip",
    "sha256": "<64 lowercase hex characters>",
    "size": 123456,
    "apiVersion": 1,
    "minApp": "0.7.0",
    "released": "2026-11-20",
    "notes": "Optional, short.",
    "yanked": false
  }
]
```

Versions are semver, unique and ascending (newest last). `url` must be a GitHub release asset of
the repository named in `meta.json`. `apiVersion` is the plugin API version you built for,
`minApp` the lowest Questkeep version that runs the plugin.

## Release zip rules

- A normal plugin zip: `plugin.json` at the top of the zip or in its only top-level folder.
- `plugin.json` has the same `id` and `version` as the `versions.json` entry (and the same
  `apiVersion`). CI downloads each new version and checks this, the SHA-256 and the size.
- Use forward slashes in zip entry names.
- The release must be public (not a draft) and its asset must never be replaced afterwards:
  the hash is pinned. To change anything, publish a new version.

## Publish a new version

Open a pull request that appends an entry to `plugins/<id>/versions.json` (newest last). Only new
entries are downloaded and checked. Changing the `url` or `sha256` of an existing entry is
reviewed as a new release.

## Yank a version

Set `"yanked": true` on the entry in a pull request, and say why. A yanked version is hidden from
the browser unless "show all versions" is on, is never offered as an update, and stays listed
so people who installed it can see what they have. If the version is malicious, also report it
through [SECURITY.md](SECURITY.md).

## What review checks

- **Source:** the repository is public, has a license, and matches `repository`. The zip can be
  built from that source.
- **No obfuscated code:** no minified-only or obfuscated sources, no hidden downloads of code
  at run time.
- **Permissions (stores):** every permission in `plugin.json` (`http` hosts, `read`/`write`
  folders, `filesystem`, `registry`, `launcher`, `login`) is the minimum the plugin needs, and the
  description and the PR say what each is for.
- **Broad access (`filesystem` or `registry`):** such a store can read everything the user can,
  and what it reads can only leave the PC through its `permissions.http` hosts and
  `login.domains`, so those get the most attention:
  - No wildcard hosts and no shared-hosting domains (`*.github.io`, `*.pages.dev`, storage
    buckets and similar) in `http` or `login.domains`: anyone can put content on them.
    `scripts/validate.mjs` rejects the common ones.
  - `http://localhost` (or any `http://` host) needs a reason stated in the PR.
  - Hosts are the store's own (API, CDN, sign-in). Explain every host in the PR.
  - Tokens go to the system keyring through the SDK's `secrets`, never to `/data`: any plugin
    with `filesystem` can read that.
  - An update that adds `filesystem`, `registry`, a host, a sign-in domain or a launcher program
    is reviewed like a new plugin.
- **`minApp`:** older Questkeep versions ignore `filesystem`, `registry`, `launcher` and `login`,
  so a plugin that declares any of them must set `minApp` to the first version that has them
  (0.7.0 or later). CI checks this.
- **Extension trust:** extensions run as trusted code, so review reads their JavaScript. They must
  do what the description says and nothing else.
- **Metadata:** accurate name, summary and description, `kinds` matches what the plugin brings,
  the icon is yours to use.
- **Updates:** a new version is reviewed for what changed in permissions and behavior.
