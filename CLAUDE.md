# Repo guidance for AI assistants

## Releases require Conventional Commits

This repo publishes `@nxlv-ai/jevify` to npm through
[release-please](https://github.com/googleapis/release-please). Only
Conventional Commits move the version:

| Commit prefix | Version bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer | major |
| `chore:` `docs:` `ci:` `test:` `refactor:` `build:` `style:` | none |

A change that should ship to npm must carry a `fix:` or `feat:` commit.

## Release pipeline

1. Push Conventional Commits to `main`.
2. `.github/workflows/release.yml` runs release-please, which opens or updates a
   Release PR bumping `package.json` and writing `CHANGELOG.md`.
3. Merging the Release PR creates the tag and GitHub Release, and the same run
   builds and publishes to npm via OIDC Trusted Publishing (no `NPM_TOKEN`).
4. Nothing reaches npm until the Release PR is merged.

Backfill a release that did not publish: `gh workflow run release.yml -f publish=true`.

npm publish needs a Trusted Publisher on npmjs.com for the package (user
`lucioamor`, repo `jevify-mcp-server`, workflow `release.yml`, no environment).
Without it, publish fails with `E404`.

Version source of truth: `.release-please-manifest.json`.

## Repo conventions

- `src/engine/` is shared with the hosted jevify service. Keep it free of
  network, storage and model calls; the local server must stay offline.
- All GitHub Actions are SHA-pinned (full commit SHA, version in a trailing comment).
- Line endings are LF via `.gitattributes`.
- Run `npm run check` before committing. The stdio tests run the built bundle.
