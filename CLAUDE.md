# Gate — Claude Code Context

Read `GUIDE.md` for the full technical reference. This file has what you need to get oriented fast.

## Quick Start

```bash
npm install       # or: brew install gate / npx @penumbra/gate
cd your-project
npx gate          # installs pre-commit hook, starts protecting
gate scan --all   # full repo scan
```

No database, no server, no Redis. Gate is a pure CLI tool.

## Project Structure

Pure JavaScript CLI. No build step needed.

```
bin/gate.js           — CLI entry point (commands: scan/fix/report/purge/init/status/audit/vault/install/update)
src/cli/              — Scanner modules (pure JS)
  scanner.js          — Core scanning engine (pattern matching + entropy)
  rules.js            — 78 built-in rules + loader for rules.json
  config.js           — .gaterc config file loader
  ignore.js           — .gateignore pattern matching
  output.js           — Terminal formatting (color, CI detection, SARIF)
  audit.js            — Local audit log (append, query, export, verify)
  installer.js        — Git hook installer (pre-commit + pre-push)
  init.js             — Interactive project setup (generates .gaterc/.gateignore)
  status.js           — Health check display
  remediation.js      — Fix guidance per secret type
  updater.js          — Self-update checker
  vault.js            — Local secret encryption (AES-256-GCM)
  verify.js           — Credential verification (live API checks per provider)
  fixer.js            — Auto-fix engine (extract to .env, rewrite source, 9 languages)
  interactive.js      — Interactive remediation TUI (single-keypress actions)
  incident.js         — Incident response workflow (5-step guided process)
  reporter.js         — Report generation (Markdown, HTML, SARIF 2.1.0, JSON)
  history.js          — Git history scanner + purge script generator
  exposure.js         — Exposure assessment (LOCAL / COMMITTED / PUSHED / UNKNOWN)
src/shared/           — TypeScript modules (compliance, remediation, strategies)
rules/rules.json      — 281 detection patterns (cryptographically signed)
rules/fortress.js     — Rule signing, verification, and testing CLI
test/                 — Integration tests
src/cli/__tests__/    — Unit tests (18 suites)
github-action/        — GitHub Action for CI/CD (separate)
```

## Key Conventions

- **Pure JS** — no build step, no transpilation for CLI modules
- **Zero-config** — works out of the box, `.gaterc` is optional
- **First run installs hook** — `npx gate` in a git repo auto-installs pre-commit hook
- **Config file** — `.gaterc` (YAML or JSON) for per-project settings
- **Ignore file** — `.gateignore` for suppressing false positives (glob + rule-scoped patterns)
- **Audit trail** — `~/.gate/audit.jsonl` with SHA-256 integrity chain

## Tech Stack

Node.js (>=18), js-yaml. That's it. Zero runtime dependencies beyond js-yaml.

Dev dependencies: Jest, TypeScript (for shared modules only).

## Testing

```bash
npm test                    # all 386+ tests
npm run test:cli            # CLI tests only
npx jest --watch            # watch mode
```

18 test suites covering scanner, rules, config, ignore, output, init, status, installer, audit, rules expansion, self-scan, exposure, fixer, interactive, incident, reporter, history, and verify.

## What Was Last Worked On (March 2026)

Gate v2 Phase 1 — complete rewrite from SaaS to pure CLI:
- Removed all SaaS infrastructure (Express backend, React frontend, Prisma/PostgreSQL, Redis/BullMQ, Stripe billing, OAuth)
- Rebuilt CLI with .gaterc config, .gateignore suppression, beautiful terminal output
- Expanded detection rules from 256 to 281 patterns
- Added pre-push hooks alongside pre-commit
- Added `gate init` interactive setup, `gate status` health check
- Self-scan validated: `gate scan --all` produces zero findings on own source code
- 12 test suites, 262 tests passing

Gate v2 Phase 2 — remediation engine:
- **Credential verification** (`gate scan --verify`) — live API checks to confirm if secrets are active; caches results in `~/.gate/verify-cache.json`
- **Auto-fix engine** (`gate fix`) — extracts secrets to `.env`, rewrites source to use `process.env` references; supports JS/TS, Python, Go, Ruby, Java, YAML, Terraform, JSON, Dockerfile; `--dry-run` and `--undo` supported
- **Interactive remediation TUI** (`gate scan --interactive`) — single-keypress actions (fix, ignore, vault, copy, skip) for each finding; uses Node raw mode, no external deps
- **Incident response workflow** — 5-step guided process (ROTATE, AUDIT, CLEAN CODE, SCRUB HISTORY, DOCUMENT) triggered for PUSHED secrets; provider-specific instructions for AWS, GitHub, Stripe, GCP, Azure, Heroku, and more
- **Compliance reports** (`gate report`) — Markdown and HTML reports with OWASP, NIST, CIS, SOC 2 compliance mappings per finding
- **SARIF 2.1.0 output** (`gate scan --format sarif`) — compatible with GitHub Advanced Security / GitHub Code Scanning
- **Git history scanning** (`gate scan --history N`) — scans last N commits for secrets introduced and later removed
- **Purge script generation** (`gate purge`) — generates `git-filter-repo` scripts to excise secrets from full git history
- **Exposure assessment** — classifies each finding as LOCAL / COMMITTED / PUSHED / UNKNOWN to drive appropriate remediation path
- 18 test suites, 386+ tests passing, zero self-scan findings

## Remaining Work

### Phase 3 — Dashboard Rebuild
- `gate serve` — local web dashboard (React SPA, read-only, no database)
- Timeline view of scan history from audit log
- Finding detail pages with remediation guidance

### Phase 4 — Distribution
- `npm publish` to registry (`@penumbra/gate`)
- Homebrew formula (`brew install gate`)
- VS Code extension (highlights secrets inline, runs gate on save)
- GitHub Marketplace action (already scaffolded in `github-action/`)

## Companion Repos

- `penumbraforge/penumbraforge-site` — marketing site (Cloudflare Workers)
- `penumbraforge/dotfiles` — AI coding tool configs (Ollama, Aider, MCP skills, etc.)
