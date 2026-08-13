# Changelog

All notable changes to Gate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-08-12

### Security
- **Stop leaking plaintext secrets** in scan reports, JSON/SARIF output, and
  generated purge artifacts. The `match` field is now redacted and each finding
  carries a `secretHash` (SHA-256 prefix); purge scripts are written under
  `~/.gate/purge/` instead of alongside source.
- **Credential verification is now opt-in and OFF by default.** It runs only
  when `--verify` is passed (or `verify: true` is set in `.gaterc`), never
  implicitly — so scans no longer make live API calls with detected secrets
  unless you ask.

### Changed
- **Node.js baseline raised to >= 22** (18 and 20 are EOL); CI matrix is now
  22 / 24 / 26. May be breaking for older runtimes.
- **JSON and SARIF output redact the secret value** (previously the raw match
  could appear) and add a `secretHash` field — a behavioral change for anything
  parsing scan output.
- **GitHub Action rebuilt to actually run:** metadata moved to a repo-root
  `action.yml` (runs.using `node24`), source bundled with `@vercel/ncc` into
  `github-action/dist/index.js`. `uses: penumbraforge/gate@v2` now resolves.
- Removed the unused TypeScript toolchain (`typescript`, `@types/*`,
  `tsconfig.json`); committed `package-lock.json` for reproducible `npm ci`.

### Fixed
- **Load the FORTRESS rules.json pack into the live rule set.** Its 68 signed
  rules were only signature-checked, never used for detection — the advertised
  PII/K8s/SQLi/DigitalOcean coverage did not actually exist. They are now
  deduplicated against the built-ins and merged, giving 111 live rules.
- Fixed 64 KiB stdout truncation that could corrupt large JSON/SARIF output.
- Fixes now rewrite only the secret value (`finding.secret`) instead of the
  whole matched line; exposure assessment uses the same precise value.
- Installer no longer clobbers foreign git hooks — the Gate sentinel is the
  only marker it will overwrite.
- Fixed a `withTimeout` timer leak, updater/build-step and release-remote bugs,
  skipped-file miscounting, and several entropy false positives.
- Vault now persists the full ciphertext so the interactive Vault action is
  recoverable via `VAULT:<id>` from `~/.gate/vault.json`.
- Staged deletions no longer break the pre-commit scan (a commit that only
  removes files was previously blocked by Gate's own hook).

### Added
- Live PII detection (US SSN, credit card), Kubernetes secrets, SQL-injection,
  DigitalOcean, Azure key variants, and more — from the newly-loaded FORTRESS
  pack.
- `use-local` action input to run the checked-out CLI (`node bin/gate.js`)
  instead of the npm package, enabling CI self-tests of unreleased versions.
- Audit-log rotation: `~/.gate/audit.jsonl` rotates at 5MB (two generations).
- `scan-report` action output is capped under GitHub's 1 MiB output limit.
- `scripts/gen-docs.js` generates the rule-count docs from the live rule set,
  with a `--check` mode enforced in CI, plus new CI jobs for coverage,
  action-bundle freshness, and an unmocked action self-test.

## [2.0.1] — 2026-03-31

### Changed
- Updated built-in rule count from 78 to 80 (148 total with FORTRESS)
- Hardened scan, fix, and GitHub Action workflows
- Cleaned all legacy SaaS and monetization artifacts from documentation
- Fixed package name references across all documentation (`@penumbraforge/gate`)
- Fixed GitHub Action examples to use `penumbraforge/gate@v2`
- Rewrote GitHub Action SECURITY.md, TROUBLESHOOTING.md, and CHANGELOG.md for v2
- Removed stale v1 delivery documents and legacy config file examples
- Updated release script for pure CLI workflow (removed Cloudflare Worker references)
- Removed stale `v2-clean` branch from CI triggers
- Updated version from beta to stable release

## [2.0.0] — 2026-03-22

Complete rewrite from SaaS to pure CLI. Gate is now free, forever.

### Added
- Zero-config CLI secret scanner — works out of the box with `npx @penumbraforge/gate`
- 148 detection rules (80 built-in + 68 FORTRESS) covering AWS, GCP, Azure, GitHub, Stripe, OpenAI, Anthropic, and 50+ more providers
- Auto-fix engine across 9 languages (JS/TS, Python, Go, Ruby, Java, YAML, Terraform, JSON, Dockerfile)
- Credential verification for 23 providers — confirms if detected secrets are live
- Interactive remediation TUI with exposure-aware actions and pagination
- Incident response workflow — 5-step guided process for compromised secrets
- Compliance reports with OWASP Top 10, NIST SP 800-53, CIS Controls, SOC 2 mappings
- SARIF 2.1.0 output for GitHub Code Scanning / GitHub Advanced Security
- Git history scanning and purge script generation
- Local secret vault with AES-256-GCM encryption
- Append-only audit log with SHA-256 integrity chain
- Pre-commit and pre-push git hook installation
- `.gaterc` YAML configuration with custom rules and severity overrides
- `.gateignore` with glob patterns, negation, brace expansion, rule-scoped suppression, and inline `gate-ignore` comments
- Progress spinner with per-file scan feedback
- Per-command `--help` flag support
- User-level config at `~/.config/gate/config.yaml`
- File size guard (default 2MB) to prevent OOM on large files
- Robust Node.js resolution in hooks (nvm, fnm, volta, asdf support)
- `--changed` flag for pre-push scope (scan only upstream diff)
- Multiline secret detection (base64 blocks, template literals, concatenation)
- GitHub Action for CI/CD integration

### Removed
- All SaaS infrastructure (Express backend, React frontend, Prisma/PostgreSQL, Redis/BullMQ, Stripe billing, OAuth)
- Authentication, licensing, and billing — Gate is now completely free
- Cloud-dependent features — everything runs locally

### Security
- Cryptographic rule signing (FORTRESS engine) with runtime verification
- Audit log integrity chain (SHA-256)
- Vault encryption (AES-256-GCM) for local secret storage
- Zero runtime dependencies beyond js-yaml
