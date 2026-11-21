# Security

## Reporting a malicious or vulnerable plugin

If a listed plugin contains malicious code, steals data, or abuses the permissions it was
granted, or if you find a vulnerability in the registry itself, please report it privately:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** (a private security advisory).
3. Say which plugin and version, and what you found.

Please do not open a public issue for it. We will yank the version (or remove the plugin) as
soon as the report is confirmed, and publish an advisory afterwards.

## What the registry guarantees

Every plugin is reviewed in a pull request before it is listed, and every version is pinned by
SHA-256, so a compromised plugin repository cannot change what a listed version contains.
Store plugins run sandboxed; extensions run as trusted code, which Questkeep warns about at
install time.

A plugin with `filesystem` or `registry` access that sends data to hosts its function does not
need counts as abusing its permissions: report it as above.
