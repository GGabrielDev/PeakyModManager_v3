# Build-selected update authority

All packaging commands use `electron-builder.config.cjs`. GitHub Actions defaults to its own `GITHUB_REPOSITORY`; set `PMM_RELEASE_REPOSITORY=OWNER/REPO` for a dedicated release repository. That repository must also be the publication destination. The token authenticates publishing and is never client configuration. Cross-repository publication needs a token with write access to the selected repository.

`PMM_RELEASE_CHANNEL` is `latest` (stable) or `preview`. Preview builds permit prereleases; stable builds do not. Channel metadata generation never creates metadata for other channels. CI must use a matching prerelease version and upload the matching metadata. Local builds without an explicit repository make no update requests, even if package metadata names upstream. Native package installations use their package manager, not AppImage replacement.

The build embeds public source metadata in the main bundle and packaged `package.json`. Inspect `resources/app-update.yml` and `pmmUpdateSource` in packaged metadata before distribution. A missing or unavailable selected feed produces an updater error, never an upstream fallback. Existing user data and application identity are unchanged. Switching from upstream requires deliberately installing a build with the new source; there is no runtime source switch.

Validation: release-source tests cover upstream/fork defaults, override, malformed input, local-disabled policy and channel selection. Actual staged N→N+1 upgrade remains part of packaged validation; source tests alone do not establish a successful desktop upgrade.
