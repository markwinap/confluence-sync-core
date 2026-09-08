# @markwinap/confluence-sync-core

Framework-neutral Confluence content synchronization library.

This package provides the shared engine used by `confluence-sync` (CLI) and the VS Code extension. It is not intended to be used directly by end users.

## Publishing

Push a commit to `main` with a new `version` in `package.json` to publish it. The GitHub repository requires an `NPM_TOKEN` Actions secret containing an npm granular access token with publish permission for `@markwinap/confluence-sync-core`.
