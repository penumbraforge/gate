# Changelog

All notable changes to the Gate GitHub Action are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-03-22

### Changed
- Complete rewrite to wrap the Gate v2 CLI (`@penumbraforge/gate`)
- Gate is now free and open source (Apache 2.0) — no license checks
- Configuration via `.gaterc` (YAML/JSON) and `.gateignore` instead of `.gate.json`
- Action inputs simplified: `mode`, `verify`, `format`, `fail-on`, `failure-mode`, `slack-webhook`, `github-token`

### Added
- `verify` input — run credential verification for supported providers
- `format` input — `text`, `json`, or `sarif` output
- `fail-on` input — minimum severity threshold (`critical`, `high`, `medium`, `low`)
- SARIF upload to GitHub Code Scanning when `format: sarif`
- Scan errors treated as incomplete security result (configurable via `failure-mode`)

### Removed
- License verification (Gate is completely free)
- `.gate.json` and `.gate-allowlist.json` configuration (replaced by `.gaterc` and `.gateignore`)
- `rules-version` input (rules ship with the CLI)
- Bypass detection features
- All SaaS and monetization dependencies

## [1.0.0] — 2024-01-15

### Added
- Initial release
- Enforce and report modes
- PR comments with findings
- Slack integration
- Configurable failure modes (block/warn)

## Support

- GitHub Issues: https://github.com/penumbraforge/gate/issues
- Community: https://github.com/penumbraforge/gate/discussions
- Email: support@penumbraforge.com

## License

Apache 2.0 — See [LICENSE](LICENSE) file
