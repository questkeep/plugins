<!-- Delete the sections that do not apply. -->

## What does this PR do?

- [ ] Adds a new plugin: `plugins/<id>/`
- [ ] Adds a new version of an existing plugin
- [ ] Yanks a version
- [ ] Other (registry scripts, docs, workflows)

## Checklist for plugin authors

- [ ] `node scripts/validate.mjs` passes locally (and `--online` for new versions)
- [ ] The source repository is public, has a license, and matches `repository` in `meta.json`
- [ ] The release zip is a normal plugin zip: `plugin.json` at its top or in its only folder, same `id` and `version` as the entry
- [ ] `sha256` is of the exact file attached to the GitHub release, and the release is not a draft
- [ ] `apiVersion` and `minApp` are correct for this build
- [ ] No obfuscated or minified-only code: the zip can be built from the public source
- [ ] If the plugin declares `filesystem` or `registry`: the PR lists every web host (`http`) and sign-in domain (`login.domains`) and why the plugin needs it, with no wildcards or shared-hosting domains
- [ ] If the plugin declares `filesystem`, `registry`, `launcher` or `login`: `minApp` is at least the first Questkeep version with them (0.7.0)
- [ ] I listed the permissions the plugin asks for and why (stores), or what the extension does with its trust (extensions):

<!-- describe permissions / extension behavior here -->

## Notes for the reviewer
