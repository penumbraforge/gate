# Changelog

All notable changes to Gate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
