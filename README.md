# Questkeep plugin registry

The list of plugins that Questkeep shows in **Settings > Plugins**. Plugins are reviewed here
by pull request; the plugin files themselves stay in the authors' own GitHub Releases, and this
repository pins each file by SHA-256.

- Index the app reads: <https://questkeep.github.io/plugins/index.json>
- Want to list a plugin? See [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a malicious plugin? See [SECURITY.md](SECURITY.md).

## How the app uses it

1. Questkeep fetches `index.json` (https only, cached for offline use).
2. It offers the versions that match its plugin API version and app version and are not yanked.
3. On install it downloads the zip from the author's release, checks the SHA-256 from the
   index, shows the normal install preview (permissions, extension trust warning) and installs.
4. Installed registry plugins show "Update available" when a newer compatible version is listed.

The full contract (file formats, index schema, app behavior) is `docs/PLUGIN_REGISTRY.md` in the
[Questkeep repository](https://github.com/MaSch0212/questkeep).

## Layout

```
plugins/<id>/meta.json       what the browser shows (reviewed on every PR)
plugins/<id>/icon.svg        or icon.png (square, SVG preferred, PNG 256x256 max, 200 KB max)
plugins/<id>/versions.json   every released version, newest last
scripts/validate.mjs         checks the entries (add --online to download and verify new versions)
scripts/build-index.mjs      writes site/index.json and copies icons to site/icons/
.github/workflows/           ci.yml (tests, validate, build), pages.yml (deploy site/),
                             links.yml (weekly check that every download still matches)
```

## Development

Node 24, no dependencies.

```
node --test scripts/*.test.mjs    # tests
node scripts/validate.mjs         # check plugins/ (add --online [--all] to download the zips)
node scripts/build-index.mjs      # writes site/
```
