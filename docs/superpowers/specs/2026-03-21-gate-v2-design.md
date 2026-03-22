# Gate v2 Design Spec

**Date:** 2026-03-21
**Author:** Penumbra
**Status:** Approved

---

## Vision

Gate v2 is a complete redesign. Gate becomes the world's best free secret scanner — the first tool that doesn't just detect secrets but verifies, remediates, and documents them through a complete incident response lifecycle.

**Identity:** "Other tools find secrets. Gate fixes them. For free."

**Principles:**
- Zero friction — `npx gate` and you're protected
- User choice at every level — inform, guide, or auto-fix
- Runs 100% locally — no cloud, no accounts, no telemetry
- Completely free — no tiers, no quotas, no paywalls
- Robust over clever — every feature works reliably or fails gracefully

---

## What Gets Deleted (The Great Purge)

All SaaS/commercial infrastructure is removed. Gate is a CLI tool and GitHub Action, not a platform.

### Files deleted entirely

```
## Entire src/backend/ directory (deleted)
src/backend/                               (entire directory — rebuilt from scratch in Phase 3)

## Entire src/workers/ directory (deleted)
src/workers/                               (entire directory — no background jobs in v2)

## Entire src/frontend/ directory (deleted in Phase 1, rebuilt in Phase 3)
src/frontend/                              (entire directory — rebuilt as lightweight local UI)

## Backend-adjacent files
prisma/                                     (entire directory)
prisma.config.ts

## CLI files removed
src/cli/license.js
src/cli/auth.js
src/cli/__tests__/license.test.js
src/cli/__tests__/auth.test.js

## Build configs that reference deleted code
tsconfig.backend.json                       (no backend to compile)
tsconfig.frontend.json                      (no frontend to type-check in Phase 1)
```

**Why delete entire directories instead of cherry-picking files:**

The backend, workers, and frontend are deeply entangled with SaaS infrastructure (Prisma, Redis, Passport, Stripe, JWT auth, CSRF, rate limiting, env validation for 11 production secrets). Surgically removing references would leave broken files everywhere. A clean delete with a fresh Phase 3 rebuild is faster and safer.

The `src/shared/` directory is kept — it contains `remediation.ts`, `compliance.ts`, `strategies.ts`, `rules.ts`, `sanitize.ts`, and `logger.ts`. These are self-contained and useful. `scanner.ts` in `src/shared/` is merged into the CLI `src/cli/scanner.js` (the authoritative scanner) and then deleted.

### Files modified (purge dead references)

- `bin/gate.js` — remove all license/auth/billing/serve/worker commands and imports. The `serve` command becomes a stub that prints "Dashboard available in Gate v2.1 (Phase 3)" until Phase 3 ships.
- `package.json` — comprehensive update (see below)

### package.json changes

**Dependencies removed:**
```
stripe, passport, passport-github2, connect-redis, bcryptjs,
express-session, bullmq, redis, @prisma/client, @prisma/adapter-pg,
pg, node-cron, express, helmet, cors, compression, cookie-parser,
axios, react, react-dom, zustand, clsx, @tanstack/react-router,
@tailwindcss/postcss, tailwindcss, dotenv, jsonwebtoken, uuid, zod
```

**DevDependencies removed:**
```
prisma, ts-jest, @vitejs/plugin-react, autoprefixer, postcss,
vite, vitest, jsdom, nodemon, concurrently,
all @types/* packages for removed dependencies,
@testing-library/react, @testing-library/jest-dom,
@testing-library/user-event
```

**Dependencies added:**
```
js-yaml  (~30KB, zero sub-dependencies — for .gaterc YAML parsing)
```

The YAML dependency is an explicit, acknowledged tradeoff. JSON config was considered but YAML is significantly more readable for the `.gaterc` use case (comments, no quoting of keys, multiline strings for custom rule patterns). `js-yaml` is the standard choice (47M weekly downloads, zero transitive dependencies).

**`files` field updated** (controls what `npm publish` includes):
```json
"files": ["bin", "src/cli", "rules", "README.md", "LICENSE"]
```

No `dist/`, no `prisma/`, no `src/frontend/`, no `src/backend/`. The CLI is pure JS — it ships source directly.

**Scripts updated:**
```json
"scripts": {
  "test": "jest",
  "test:cli": "jest --selectProjects cli",
  "test:watch": "jest --watch"
}
```

Build scripts removed (no TypeScript compilation needed for CLI). Build scripts for the dashboard return in Phase 3.

### Result

Zero orphaned imports. Zero commented-out code. Zero "// removed in v2" markers. The codebase reads as if the old code never existed.

---

## Architecture Overview

```
gate/
├── bin/gate.js                 # CLI entry point (pure JS)
├── src/
│   ├── cli/
│   │   ├── scanner.js          # Detection engine
│   │   ├── rules.js            # Rule loading + custom rules
│   │   ├── verify.js           # NEW: Credential verification
│   │   ├── remediation.js      # Remediation map + guidance
│   │   ├── fixer.js            # NEW: Auto-fix engine
│   │   ├── interactive.js      # NEW: Interactive remediation TUI
│   │   ├── incident.js         # NEW: Incident response workflows
│   │   ├── reporter.js         # NEW: Report generation (MD/HTML/SARIF/JSON)
│   │   ├── config.js           # NEW: .gaterc loading + smart defaults
│   │   ├── ignore.js           # NEW: .gateignore + inline suppression
│   │   ├── vault.js            # Local AES-256-GCM encryption
│   │   ├── audit.js            # Local audit log (audit.jsonl)
│   │   ├── installer.js        # Git hook installer (pre-commit + pre-push)
│   │   ├── updater.js          # Self-update checker
│   │   ├── init.js             # NEW: Project setup
│   │   ├── status.js           # NEW: Health check
│   │   ├── output.js           # NEW: Terminal formatting engine
│   │   └── __tests__/          # Tests for all modules
│   ├── shared/
│   │   ├── remediation.ts      # Remediation map (TS version)
│   │   ├── compliance.ts       # OWASP/NIST/CIS/SOC2 mappings
│   │   ├── strategies.ts       # Remediation strategies (unlocked)
│   │   ├── rules.ts            # Shared rule types
│   │   ├── sanitize.ts         # Output sanitization
│   │   └── logger.ts           # Structured logging
│   └── frontend/               # Phase 3: Simplified local dashboard
├── rules/
│   ├── rules.json              # 300+ detection patterns (signed)
│   ├── rules.json.sig          # HMAC-SHA256 signature
│   └── fortress.js             # Rule signing/verification CLI
├── github-action/              # GitHub Action for CI/CD
└── test/                       # Integration tests
```

The CLI is pure JavaScript (no build step, no TypeScript compilation needed to run). The `src/shared/` TypeScript modules are compiled for the dashboard (Phase 3) and GitHub Action but the CLI operates independently.

---

## Feature Specifications

### 1. Installation & Setup

#### `npx gate` — zero-install protection

Running `npx gate` (or `npx @penumbra/gate`) in a git repository:
1. Detects it's a git repo (or exits with a helpful message)
2. Installs the pre-commit hook
3. Prints one line of confirmation
4. Done

```
$ npx gate

  gate · pre-commit hook installed
  Your commits are now protected.
```

No config files created. No questions asked. No wizard. The tool works with smart defaults immediately.

**Behavior when hook is already installed:**
- `npx gate` (no subcommand) → prints `gate status` output (hook status, last scan, rule count)
- `npx gate scan` → runs a scan of staged files
- `npx gate scan --all` → runs a full repo scan
- The bare command never silently runs a scan — status is the safe, informative default

#### `brew install gate`

Homebrew formula for native macOS installation. Also serves as the mechanism for Linux via Linuxbrew.

#### `npm install -g @penumbra/gate`

Global install for developers who prefer npm.

#### `gate init` — optional interactive setup

For users who want to customize. Detects project stack and offers sensible choices:

```
$ gate init

  gate · project setup

  Detected: Node.js (package.json), Git repository

  ✓ Pre-commit hook installed
  ✓ Created .gateignore (Node.js defaults)
  ✓ Added .env, .env.local, .env.*.local to .gitignore

  Optional:
    Create .gaterc for custom configuration? [y/N]
    Install pre-push hook too? [y/N]

  Done. Try: gate scan --all
```

Stack detection table:

| File detected | Language | .gateignore defaults |
|---|---|---|
| `package.json` | Node.js | `node_modules/**`, `*.min.js`, `dist/**`, `build/**`, `coverage/**` |
| `requirements.txt` / `pyproject.toml` | Python | `venv/**`, `__pycache__/**`, `.tox/**`, `*.pyc` |
| `go.mod` | Go | `vendor/**` |
| `Gemfile` | Ruby | `vendor/bundle/**` |
| `Cargo.toml` | Rust | `target/**` |
| `pom.xml` / `build.gradle` | Java | `target/**`, `build/**`, `*.class` |
| `*.sln` / `*.csproj` | .NET | `bin/**`, `obj/**` |

#### `gate status` — health check

```
$ gate status

  gate v2.0.0
  hook      pre-commit ✓  pre-push ✗
  config    defaults (no .gaterc)
  ignore    .gateignore (12 patterns)
  rules     312 patterns · v2.0.0
  last scan 3 min ago · 14 files · 0 findings
  audit     47 scans · 3 incidents resolved
```

---

### 2. Configuration System

#### Smart defaults (zero-config path)

Gate works without any configuration. Defaults are tuned for the lowest false-positive rate with the highest detection rate:

| Setting | Default | Rationale |
|---|---|---|
| Entropy threshold | 4.0 (raised from 3.8) | 3.8 produces too many false positives on real codebases |
| Entropy threshold (high-entropy files) | 4.5 | Files with naturally high entropy (hashes, generated code, minified) get a higher bar |
| Hooks | `pre-commit` | Pre-push is available but opt-in |
| Verification | `true` (when online) | Verify credentials are live; skip silently when offline |
| Output | `text` with color | Beautiful terminal output |
| Context lines | 2 | Lines of code shown above/below findings |
| Auto-ignore test fixtures | `true` | Credentials verified as inactive are auto-downgraded |

#### `.gaterc` — per-project overrides (YAML)

Only created when the user explicitly asks (`gate init` with custom config, or manually). Never auto-generated.

```yaml
# .gaterc

# Override defaults
entropy_threshold: 4.2
verify: true
hooks:
  - pre-commit
  - pre-push

# Severity overrides
severity:
  sentry-dsn: ignore        # Not a secret in our context
  aws-account-id: ignore    # Semi-public

# Custom detection rules
rules:
  - id: acme-internal-key
    name: "ACME Internal API Key"
    pattern: "acme_[a-z]{4}_[A-Za-z0-9]{40}"
    severity: critical
    remediation: "Rotate at https://internal.acme.com/keys"

  - id: acme-service-token
    name: "ACME Service Token"
    pattern: "ast_[A-Za-z0-9]{64}"
    severity: high
    remediation: "Regenerate in ACME admin console"

# Output preferences
output:
  format: text             # text | json | sarif
  color: auto              # auto | true | false
  context_lines: 3
```

Resolution order: inline `gate-ignore` > `.gateignore` > `.gaterc` > smart defaults.

#### `.gateignore` — false positive suppression

Follows `.gitignore` glob syntax:

```gitignore
# Skip test fixtures
test/fixtures/**
**/__fixtures__/**
**/testdata/**

# Skip generated files
*.generated.*
*.min.js
*.bundle.js

# Skip specific rule IDs in specific paths
# Syntax: [rule:<rule-id>] <glob>
# Uses bracket prefix (not !) to avoid conflict with .gitignore negation syntax
[rule:high-entropy-string] src/crypto/**
[rule:aws-account-id] infrastructure/docs/**
```

#### Inline suppression

```js
const EXAMPLE = "AKIAIOSFODNN7EXAMPLE"; // gate-ignore
const TEST_KEY = "sk_test_abc123";       // gate-ignore: test fixture
```

The comment `gate-ignore` on any line excludes it from scanning. The optional reason after the colon is recorded in the audit log for compliance traceability.

---

### 3. Detection Engine

#### Rule expansion (256 → 300+)

New rules to add, covering services developers actually use in 2026:

| Service | Rule ID | Pattern prefix/format |
|---|---|---|
| Vercel | `vercel-token` | Bearer tokens from Vercel API |
| Netlify | `netlify-token` | Netlify personal access tokens |
| Cloudflare | `cloudflare-api-key` | Cloudflare Global API keys |
| Cloudflare | `cloudflare-api-token` | Cloudflare scoped API tokens |
| Linear | `linear-api-key` | `lin_api_` prefix |
| Notion | `notion-api-key` | `ntn_` or `secret_` prefix |
| Doppler | `doppler-token` | `dp.st.` prefix |
| 1Password | `onepassword-token` | 1Password service account tokens |
| HashiCorp Vault | `vault-token` | `hvs.` prefix |
| Terraform Cloud | `terraform-token` | `atlasv1.` prefix or TFE tokens |
| PlanetScale | `planetscale-token` | `pscale_tkn_` prefix |
| Railway | `railway-token` | Railway API tokens |
| Fly.io | `flyio-token` | `fo1_` prefix |
| Clerk | `clerk-secret-key` | `sk_live_` / `sk_test_` Clerk format |
| Resend | `resend-api-key` | `re_` prefix |
| Upstash | `upstash-token` | Upstash Redis/Kafka tokens |
| Neon | `neon-api-key` | Neon database API keys |
| Turso | `turso-token` | Turso database tokens |
| Replicate | `replicate-token` | `r8_` prefix |
| Mistral | `mistral-api-key` | Mistral AI API keys |
| Groq | `groq-api-key` | `gsk_` prefix |
| Cohere | `cohere-api-key` | Cohere AI API keys |
| Cursor | `cursor-api-key` | Cursor IDE keys |

Each new rule includes:
- Detection regex with confidence score
- Severity level
- Remediation guidance with provider-specific rotation steps and direct URLs
- Compliance framework mappings (OWASP/NIST/CIS/SOC2)
- Verification function (how to test if the credential is live)

#### Entropy analysis improvements

- Per-file-type thresholds: source code at 4.0, config files at 3.8 (more likely to contain actual secrets), minified/generated at 4.5
- Skip known high-entropy non-secret patterns: UUIDs, SHA hashes, base64-encoded non-secret data, version strings, long CSS class names, content hashes in lock files
- Track entropy across the full token, not just quoted strings — detect bare secrets assigned to variables

#### Incremental scanning

When running as a pre-commit hook, Gate only scans:
1. Lines that changed in the staged diff (not entire files)
2. New files in their entirety
3. Renamed/moved files only scan the diff

This makes Gate fast on large commits. Full-file scanning is available via `gate scan <file>` or `gate scan --all`.

#### Multi-language monorepo support

Gate auto-detects language per file (by extension and shebang), which affects:
- Auto-fix code rewriting (the env var syntax matches the language)
- Entropy thresholds (some languages naturally produce higher entropy code)
- Default ignore patterns

---

### 4. Credential Verification

When Gate finds a potential secret, it optionally verifies whether the credential is live by making a read-only API call to the provider.

#### Verification providers

| Provider | API call | What Gate learns | Safety |
|---|---|---|---|
| AWS | `sts:GetCallerIdentity` | Account ID, user ARN, active status | Read-only, no side effects |
| GitHub | `GET /user` | Username, scopes, token type, active status | Read-only |
| GitLab | `GET /api/v4/user` | Username, active status | Read-only |
| Stripe | `GET /v1/balance` | Live vs test mode, active status | Read-only |
| Slack | `POST auth.test` | Workspace, bot name, active status | Read-only |
| OpenAI | `GET /v1/models` | Active status, org | Read-only |
| Anthropic | `GET /v1/models` | Active status | Read-only |
| GCP | OAuth2 tokeninfo endpoint | Service account, project, scopes | Read-only |
| Twilio | `GET /2010-04-01/Accounts/{sid}` | Account status | Read-only |
| SendGrid | `GET /v3/user/profile` | Active status | Read-only |
| Supabase | `GET /rest/v1/` with key | Active status, project ref | Read-only |
| Vercel | `GET /v2/user` | Active status | Read-only |
| Netlify | `GET /api/v1/user` | Active status | Read-only |
| Cloudflare | `GET /client/v4/user/tokens/verify` | Active status, permissions | Read-only |
| HuggingFace | `GET /api/whoami-v2` | Username, active status | Read-only |
| Linear | `POST /graphql` (viewer query) | Active status | Read-only |
| Generic HTTP | `HEAD` or `GET` with auth header | HTTP status code | Read-only |

#### Verification behavior

- **Enabled by default** when online
- **Skips silently** when offline or when verification times out (2-second timeout per check)
- **Never modifies** anything at the provider — all calls are read-only
- **Cacheable** — verified results are cached in `~/.gate/verify-cache.json` with a 1-hour TTL to avoid repeated API calls on re-scans
- **Disable globally:** `gate scan --no-verify` or `verify: false` in `.gaterc`
- **Results affect severity:**
  - Verified LIVE → severity stays as-is or upgrades to CRITICAL
  - Verified INACTIVE → severity downgraded, finding marked as likely false positive
  - Verification failed/skipped → severity unchanged, marked as "unverified"

#### Output with verification

```
  src/config.js:12
  │  11   const stripe = require('stripe');
  │  12   const key = "sk_live_EXAMPLE_NOT_REAL_00000000";
  │                    ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  │  Stripe Live Secret Key ── CRITICAL ── VERIFIED LIVE
  │
  │  This credential is active and authenticates successfully.
  │  Mode: live (production)
  │
  │  Rotate immediately: https://dashboard.stripe.com/apikeys
```

---

### 5. Terminal Output Engine

Gate's terminal output is a first-class feature. It should feel polished and professional.

#### Design language

- Monospace-aligned columns for scan results
- Severity uses distinct visual weight: `CRITICAL` (bold + color), `HIGH`, `MEDIUM`, `LOW`
- Code snippets show 2 lines of context (configurable) with the finding underlined
- Verification status is inline with severity
- Remediation is concise (one line) with a URL when available
- Footer shows aggregate counts and next-step commands

#### Color scheme

- CRITICAL: red
- HIGH: yellow/orange
- MEDIUM: cyan
- LOW: dim/gray
- Verified LIVE: red badge
- Verified INACTIVE: green badge (auto-dismissed)
- Code context: syntax-highlighted where possible (at minimum: strings, comments, keywords)
- File paths: bold
- Line numbers: dim

#### Accessibility

- `--no-color` flag and `NO_COLOR` env var support (per no-color.org standard)
- `--color` to force color (for piping to tools that support it)
- `color: auto` in `.gaterc` detects TTY automatically
- All information conveyed by color is also conveyed by text labels

#### CI detection

Gate auto-detects CI environments (via `CI` env var, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, etc.) and adjusts:
- Disables color (unless forced)
- Disables interactive prompts
- Outputs structured format when appropriate
- Uses GitHub Actions annotations (`::error file=...`) when in GitHub Actions

---

### 6. Remediation Engine

#### Exposure assessment

Before offering remediation options, Gate assesses how exposed the secret is:

| Exposure level | How Gate determines it | Response |
|---|---|---|
| **LOCAL** | File is staged but not committed | Extract to env/vault. No rotation needed. |
| **COMMITTED** | In local commits, not pushed | Extract + offer to amend commit. |
| **PUSHED** | In remote history | Full incident response. Rotation required. |
| **UNKNOWN** | Can't determine (not in git, detached HEAD) | Treat as potentially exposed, recommend rotation. |

Determination logic:
1. `git diff --cached --name-only` — is the file staged?
2. `git log --all --oneline -- <file>` — is it in any commit?
3. `git log --remotes --oneline -- <file>` — is it in any remote-tracking branch?
4. `git log --all --diff-filter=A -- <file>` — when was it first added?

#### Pre-commit hook behavior

When the hook detects secrets, it does NOT silently exit with code 1. It presents findings and offers immediate action:

```
  gate ── 2 secrets found ───────────────────────────

  [findings displayed with code context]

  ─────────────────────────────────────────────────────
  commit blocked · 1 critical · 1 high

  [f] Fix all    [i] Interactive    [a] Abort
  >
```

If stdin is not a TTY (CI, scripted environments), Gate falls back to non-interactive mode: print findings, exit with code 1.

#### Interactive mode (`gate scan --interactive` or `[i]` from hook)

Presents each finding one at a time with contextually appropriate options:

For **LOCAL** exposure (the happy path):
- `[f] Fix` — extract to `.env`, rewrite code
- `[v] Vault` — encrypt with `gate vault`
- `[i] Ignore` — add to `.gateignore`
- `[s] Skip` — skip for now
- `[?] Explain` — full remediation guide + compliance refs

For **PUSHED** exposure (incident):
- `[r] Start incident response` — full guided workflow
- `[f] Fix code` — extract from source (with warning: not sufficient alone)
- `[s] Skip`
- `[?] Explain`

#### Auto-fix engine (`gate fix`)

Non-interactive batch mode. Fixes everything it can, reports what it did.

##### Language-aware code rewriting

Gate uses pattern-based rewriting (not AST parsing — keeping it pure JS with zero compile dependencies). Patterns cover the real-world assignment forms developers actually write:

**JavaScript / TypeScript:**

| Input pattern | Output |
|---|---|
| `const x = "secret"` | `const x = process.env.VAR_NAME` |
| `let x = 'secret'` | `let x = process.env.VAR_NAME` |
| `var x = "secret"` | `var x = process.env.VAR_NAME` |
| `{ key: "secret" }` | `{ key: process.env.VAR_NAME }` |
| `{ key: 'secret' }` | `{ key: process.env.VAR_NAME }` |
| `` `Bearer ${secret}` `` | Uses env var within template |
| `module.exports = { key: "secret" }` | `module.exports = { key: process.env.VAR_NAME }` |

Dotenv injection: if `package.json` exists and `dotenv` is not in dependencies, Gate adds `require('dotenv').config()` (or `import 'dotenv/config'` for ESM) at the top of the entry file only (detected via `main` or `bin` in package.json). If dotenv is already present, Gate does nothing.

**Python:**

| Input pattern | Output |
|---|---|
| `x = "secret"` | `x = os.environ["VAR_NAME"]` |
| `x = 'secret'` | `x = os.environ["VAR_NAME"]` |
| `{"key": "secret"}` | `{"key": os.environ["VAR_NAME"]}` |

Import injection: adds `import os` at top if not present. Suggests `python-dotenv` if no `.env` loading is detected.

**Go:**

| Input pattern | Output |
|---|---|
| `x := "secret"` | `x := os.Getenv("VAR_NAME")` |
| `x = "secret"` | `x = os.Getenv("VAR_NAME")` |
| `map[string]string{"key": "secret"}` | Uses `os.Getenv` |

Import injection: adds `"os"` to import block if not present.

**Ruby:**

| Input pattern | Output |
|---|---|
| `x = "secret"` | `x = ENV["VAR_NAME"]` |
| `x = 'secret'` | `x = ENV["VAR_NAME"]` |

**Java:**

| Input pattern | Output |
|---|---|
| `String x = "secret"` | `String x = System.getenv("VAR_NAME")` |

**YAML (docker-compose, k8s, config files):**

| Input pattern | Output |
|---|---|
| `key: secret_value` | `key: ${VAR_NAME}` |
| `key: "secret_value"` | `key: "${VAR_NAME}"` |

Adds variable to `.env.example` with a comment.

**Dockerfile:**

| Input pattern | Output |
|---|---|
| `ENV SECRET=value` | `ARG SECRET` (with build-arg documentation) |

**Terraform:**

| Input pattern | Output |
|---|---|
| `secret = "value"` | `secret = var.var_name` + generates variable block |

**JSON config files:**

JSON cannot reference env vars. Gate extracts the secret to `.env` and provides a manual migration note explaining how to load the config value from the environment in the application code.

##### Env var name derivation

Gate derives meaningful env var names, not generic ones:

| Rule ID | Derived env var name |
|---|---|
| `stripe-live-secret` | `STRIPE_SECRET_KEY` |
| `aws-access-key-id` | `AWS_ACCESS_KEY_ID` |
| `aws-secret-access-key` | `AWS_SECRET_ACCESS_KEY` |
| `postgres-uri` | `DATABASE_URL` |
| `mongodb-uri` | `MONGODB_URI` |
| `openai-api-key` | `OPENAI_API_KEY` |
| `github-pat` | `GITHUB_TOKEN` |
| `slack-bot-token` | `SLACK_BOT_TOKEN` |
| Generic / unknown | Derived from variable name in code context, or `SECRET_<N>` as last resort |

When the variable name in the code provides context (e.g., `const dbPassword = "..."`) Gate uses that: `DB_PASSWORD`.

##### .env file handling

- If `.env` exists: append new variables (never overwrite existing)
- If `.env` does not exist: create it with a header comment
- If the variable name already exists in `.env`: warn and use `_2` suffix
- Always add `.env` to `.gitignore` if not already there
- Create `.env.example` alongside `.env` with placeholder values and comments

##### Verification after fix

After every fix operation, Gate re-scans the modified files:

```
  verifying... re-scanning 2 modified files
  ✓ 0 secrets found — all clear
```

If a finding persists (complex code pattern that the fixer couldn't handle):

```
  verifying... re-scanning 2 modified files
  ⚠ 1 finding still present: src/config.js:18

  This pattern is too complex for auto-fix.
  Manual fix suggestion:
    Move the value on line 18 to an environment variable
    and reference it as process.env.PAYMENT_WEBHOOK_SECRET
```

Gate is honest when it can't fix something. It never silently skips.

##### `gate fix --dry-run`

Shows exactly what would change without modifying anything:

```
$ gate fix --dry-run

  gate ── dry run (no files modified) ────────────────

  Would extract 2 secrets:
    STRIPE_SECRET_KEY → .env
    DATABASE_URL → .env

  Would modify:
    src/config.js     lines 12, 15
    .gitignore        +.env
    .env.example      created

  Run gate fix to apply.
```

##### `gate fix --undo`

Gate stores pre-fix snapshots in `~/.gate/snapshots/`:
- Copies of all files before modification
- Timestamped, one snapshot per `gate fix` invocation
- Only the last 10 snapshots are retained

```
$ gate fix --undo

  Reverted 3 files to pre-fix state:
    src/config.js     (restored)
    .gitignore        (restored)
    .env              (removed — was created by gate fix)
```

##### Re-staging after fix

When Gate fixes files during a pre-commit hook, it automatically re-stages the modified files so the user can commit without manually running `git add`:

```
  re-staged: src/config.js, .env, .gitignore

  [c] Commit now    [d] Review diff first    [a] Abort
```

---

### 7. Incident Response Workflow

When a secret has been pushed to a remote (exposure level: PUSHED), Gate offers a full guided incident response. This matches how real security teams handle credential exposure.

#### The 5-step workflow

**Step 1: ROTATE**

Gate determines the provider from the rule ID and provides exact rotation steps:

- If the provider CLI is installed locally (detected via `which`/`command -v`), Gate offers to run the rotation command with explicit user confirmation
- If the CLI is not installed, Gate provides the exact web console path with direct URL
- Gate never auto-executes rotation — always requires user confirmation

Provider CLI detection:

| Provider | CLI | Detection | Rotation command |
|---|---|---|---|
| AWS | `aws` | `which aws` | `aws iam delete-access-key` + `aws iam create-access-key` |
| GitHub | `gh` | `which gh` | `gh auth token` + revocation via API |
| Stripe | `stripe` | `which stripe` | `stripe api_keys roll` |
| GCP | `gcloud` | `which gcloud` | `gcloud iam service-accounts keys create` + `keys delete` |
| Azure | `az` | `which az` | `az storage account keys renew` |
| Heroku | `heroku` | `which heroku` | `heroku authorizations:revoke` + `authorizations:create` |

**Step 2: AUDIT**

Gate provides the exact URL and filter parameters to check provider access logs:

```
  Check if the exposed key was used by anyone unauthorized.

  Stripe Dashboard → Developers → Logs
  https://dashboard.stripe.com/logs

  Filter by: API key ending in ...7dc
  Date range: 2026-03-07 to 2026-03-21 (14-day exposure window)

  Look for:
  • Requests from unexpected IP addresses
  • Unusual charge amounts or patterns
  • API calls you don't recognize
```

If the user reports suspicious activity, Gate logs it to the incident record and provides next steps (contact provider support, preserve logs, notify affected parties).

**Step 3: CLEAN CODE**

Standard auto-fix flow: extract secret from source, update code to use env var.

**Step 4: SCRUB HISTORY**

Gate generates a git history purge script using `git-filter-repo` (recommended) with `bfg` as an alternative. The script:
- Replaces the exact secret value with `REDACTED_BY_GATE` in all commits
- Includes post-purge cleanup commands (`reflog expire`, `gc`)
- Includes force-push commands (commented out, with warnings)
- Is saved as a file for the user to review and execute manually

Gate NEVER executes history rewriting automatically.

**Step 5: DOCUMENT**

Gate creates a structured incident record in `~/.gate/incidents/`:

```json
{
  "id": "gate-inc-20260321-001",
  "detectedAt": "2026-03-21T14:32:00Z",
  "secretType": "stripe-live-secret",
  "ruleId": "stripe-live-secret",
  "file": "src/config.js",
  "line": 12,
  "exposure": "pushed",
  "exposureWindow": {
    "firstCommit": "2026-03-07T09:14:00Z",
    "detected": "2026-03-21T14:32:00Z",
    "durationDays": 14
  },
  "verification": {
    "status": "live",
    "checkedAt": "2026-03-21T14:32:01Z"
  },
  "actions": {
    "rotated": true,
    "rotatedAt": "2026-03-21T14:33:00Z",
    "accessLogsReviewed": true,
    "suspiciousActivity": false,
    "codeFixed": true,
    "historyPurged": "pending"
  },
  "compliance": {
    "owasp": ["A07:2021"],
    "nist": ["800-63B §5.2.7"],
    "cis": ["v8 §16.4"],
    "soc2": ["CC6.1"]
  }
}
```

`gate report --incident <id>` generates a formal Markdown incident report from this data.

---

### 8. Report Generation

#### `gate report` — compliance report

Generates a report from the audit log covering all findings and their resolution status:

Output formats:
- Markdown (default) — `gate-report-YYYY-MM-DD.md`
- HTML — `gate report --format html` — styled, printable
- JSON — `gate report --format json` — machine-readable

Report contents:
- Executive summary (finding counts by severity, resolution status)
- Findings table with file, line, rule, severity, status (resolved/open/ignored)
- Compliance framework coverage (OWASP/NIST/CIS/SOC2 controls triggered)
- Incident summaries (if any incidents recorded)
- Remediation actions taken with timestamps
- Recommendations

#### `gate report --incident <id>`

Generates a formal incident report for a specific incident. Includes:
- Incident timeline
- Actions taken (with timestamps)
- Compliance references
- Recommendations for prevention

#### `gate scan --format sarif`

Outputs SARIF 2.1.0 compliant JSON. This integrates with:
- GitHub Advanced Security (Code Scanning)
- VS Code SARIF Viewer extension
- Any SARIF-compatible security dashboard

SARIF output includes:
- Tool information (name, version, rules)
- Results with locations (file, line, column)
- Rule metadata (severity, description, help URI)
- Verification status as a property bag

#### `gate scan --format json`

Machine-readable JSON for CI pipeline consumption:

```json
{
  "version": "2.0.0",
  "timestamp": "2026-03-21T14:32:00Z",
  "findings": [
    {
      "ruleId": "stripe-live-secret",
      "ruleName": "Stripe Live Secret Key",
      "severity": "critical",
      "file": "src/config.js",
      "line": 12,
      "column": 20,
      "match": "sk_live_REDACTED...XXXX",
      "verification": "live",
      "exposure": "local",
      "remediation": {
        "action": "rotate",
        "guide": "Roll key at https://dashboard.stripe.com/apikeys",
        "link": "https://dashboard.stripe.com/apikeys"
      },
      "compliance": {
        "owasp": ["A07:2021"],
        "nist": ["800-63B §5.2.7"],
        "cis": ["v8 §16.4"],
        "soc2": ["CC6.1"]
      }
    }
  ],
  "summary": {
    "filesScanned": 14,
    "totalFindings": 1,
    "critical": 1,
    "high": 0,
    "medium": 0,
    "low": 0,
    "verified": { "live": 1, "inactive": 0, "unknown": 0 }
  }
}
```

---

### 9. Git History Scanning

#### `gate scan --history [N]`

Scans the diffs of the last N commits (default: 50) for secrets that were previously committed:

```
$ gate scan --history 30
```

Implementation:
1. `git log --oneline -N` to get commit list
2. For each commit, `git diff <parent>..<commit>` to get the diff
3. Scan only added lines (not removed — those are already gone from HEAD)
4. Report findings with commit hash, date, author, and how long the secret has been in history

This is local-only. It does NOT clone or download anything. It works on the existing local git history. This is fundamentally different from repo-scraping tools — it's a developer checking their own local history.

#### `gate purge`

Generates a git history cleanup script based on findings from `gate scan --history`:

- Uses `git-filter-repo` (recommended, pip-installable)
- Falls back to BFG Repo-Cleaner instructions
- Replaces exact secret values (not whole files) with `REDACTED_BY_GATE`
- Includes pre-flight checks (is git-filter-repo installed? is the repo clean?)
- Includes post-purge commands (reflog expire, gc, force-push with lease)
- Saved as a reviewable script — NEVER auto-executed

---

### 10. GitHub Action

The existing GitHub Action is updated to match v2 capabilities:

```yaml
# .github/workflows/gate.yml
name: Gate
on: [pull_request, push]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: penumbra/gate@v2
        with:
          mode: enforce          # enforce | report
          verify: true           # credential verification
          format: sarif          # text | json | sarif
          fail-on: high          # critical | high | medium | low
```

New features:
- SARIF upload to GitHub Code Scanning (automatic when format is sarif)
- PR comments with findings and remediation guidance
- Credential verification in CI (with `verify: true`)
- Configurable failure threshold (`fail-on: high` ignores medium/low)
- GitHub Actions annotations (`::error file=...`) for inline PR feedback

---

### 11. Vault (unchanged, already good)

The local vault (`gate vault`) is kept as-is. It already uses AES-256-GCM with proper IV/auth tag handling.

Commands:
- `gate vault keygen` — generate vault key
- `gate vault encrypt <value>` — encrypt a string
- `gate vault decrypt <blob>` — decrypt a blob
- `gate vault env <file>` — encrypt all values in a .env file

---

### 12. Audit Log (enhanced)

The existing `~/.gate/audit.jsonl` format is extended with new fields:

```json
{
  "timestamp": "2026-03-21T14:32:00Z",
  "version": "2.0.0",
  "command": "scan",
  "commitHash": "a1b2c3d",
  "filesScanned": 14,
  "findings": [
    {
      "ruleId": "stripe-live-secret",
      "severity": "critical",
      "file": "src/config.js",
      "line": 12,
      "verification": "live",
      "exposure": "local",
      "action": "fixed",
      "actionDetails": "extracted to .env as STRIPE_SECRET_KEY"
    }
  ],
  "resolution": "fixed",
  "integrityHash": "sha256:abc..."
}
```

New fields: `verification`, `exposure`, `action`, `actionDetails`, `version`.

Existing audit commands work as before:
- `gate audit --since 7d`
- `gate audit --stats`
- `gate audit --export json`
- `gate audit --verify` (integrity chain verification)

---

## Implementation Phases

### Phase 1: The Great Purge + CLI Core
- Delete all SaaS infrastructure
- Implement `.gaterc`, `.gateignore`, inline suppression
- Implement smart defaults and stack detection
- Implement `gate init`, `gate status`
- Implement terminal output engine with color and code context
- Implement `npx gate` single-command install
- Update `gate install` for pre-push hook support
- Expand rules to 300+
- Update all tests

### Phase 2: Remediation Engine
- Implement credential verification (verify.js)
- Implement auto-fix engine (fixer.js) with language-aware rewriting
- Implement interactive mode (interactive.js)
- Implement incident response workflow (incident.js)
- Implement exposure assessment
- Implement fix verification, dry-run, undo
- Implement pre-commit hook interactive flow
- Implement `gate scan --history`, `gate purge`
- Implement report generation (reporter.js) — MD, HTML, SARIF, JSON
- Update audit log format

### Phase 3: Dashboard Rebuild
- Tear down PostgreSQL/Redis/OAuth dashboard
- Rebuild as zero-config local web UI
- Reads from `~/.gate/audit.jsonl` and `~/.gate/incidents/`
- SQLite or flat-file, no database server
- No authentication (local only)
- Visual findings browser, audit log viewer, compliance report viewer
- `gate serve` opens it in the default browser

### Phase 4: Distribution + Extensions
- Publish to npm as `@penumbra/gate`
- Create Homebrew formula
- VS Code extension with real-time detection and quick-fix actions
- Polish GitHub Action for Marketplace listing
- Documentation site

---

## Edge Cases & Implementation Details

### Credential verification budget

Verification is enabled by default but must not slow down commits:

- **Per-provider timeout:** 2 seconds (hard limit)
- **Total verification budget:** 5 seconds maximum for all findings combined
- **Execution:** All verification calls run in parallel (`Promise.allSettled`)
- **Pre-commit hook:** Verification is **disabled by default in the hook** to avoid network latency during commits. The hook output says "run `gate scan --verify` to check if these are live credentials"
- **`gate scan`:** Verification is **enabled by default** (can be disabled with `--no-verify`)
- **Offline:** If no network is available, verification is silently skipped. Gate never fails because of network issues
- **Privacy:** Verification sends the credential to the provider's own API (e.g., AWS key goes to AWS). Gate never sends credentials to any third-party service

### Exposure assessment limitations

The exposure check (`local` vs `committed` vs `pushed`) uses local git state:

- `git log --remotes` relies on local remote-tracking refs, which may be stale if the user hasn't fetched
- Gate cannot know if someone else pushed the branch from another machine
- When exposure status is uncertain, Gate defaults to **UNKNOWN** and recommends treating it as potentially exposed
- Gate does NOT run `git fetch` or `git ls-remote` automatically — that would be a network call the user didn't ask for
- The output clearly labels the exposure status and its confidence: `Exposure: PUSHED (based on local refs — run git fetch to confirm)`

### Binary file handling

- Binary files are **skipped** during scanning (unchanged from v1)
- Binary detection: check first 512 bytes for null bytes and control characters
- `gate fix` never modifies binary files
- `gate scan --history` scans diffs, which show binary files as "Binary files differ" — Gate skips these
- Exception: `.env` files and other text files with unusual encodings are NOT binary — Gate handles UTF-8 and ASCII

### .env conflict handling

When `gate fix` extracts a secret to `.env` and the variable name already exists:

1. Gate reads the existing `.env` value
2. If the existing value is **identical** to the extracted secret → no-op, just update the code reference
3. If the existing value is **different** → Gate does NOT overwrite. Instead:
   - Prints a warning: `STRIPE_SECRET_KEY already exists in .env with a different value`
   - Suggests a suffixed name: `STRIPE_SECRET_KEY_NEW`
   - Uses the suffixed name in the code rewrite so the references are consistent
   - Asks the user to reconcile manually
4. Gate never silently creates mismatched `.env` entries and code references

### Re-staging guardrails

When Gate auto-fixes files during a pre-commit hook:

1. Gate runs the fix
2. Gate re-scans ALL modified files (not just the fixed lines)
3. **Only if re-scan finds zero findings** does Gate re-stage the files
4. If re-scan still finds findings (fixer couldn't fully handle the pattern):
   - Gate does NOT re-stage
   - Gate reports which findings remain and provides manual fix suggestions
   - The commit remains blocked until the user resolves manually
5. Gate never re-stages a file that still contains detected secrets

### Snapshot storage for `gate fix --undo`

Snapshots are stored per-repository, keyed by repo path:

```
~/.gate/snapshots/
  <sha256-of-repo-path>/
    <timestamp>/
      manifest.json     # lists files, their original paths, and the fix that was applied
      files/
        config.js       # pre-fix copy
        .gitignore      # pre-fix copy (or "created" marker if it didn't exist)
```

- `gate fix --undo` reads `manifest.json` from the most recent snapshot for the current repo
- Files marked as "created" by the fix are deleted on undo
- Only the last 10 snapshots per repo are retained (oldest auto-pruned)
- If `gate fix --undo` is run twice, it warns "no more snapshots to undo"

### Self-update checker (`updater.js`)

- Checks npm registry for newer versions of `@penumbra/gate`
- **Only runs** when the user explicitly runs `gate update` or `gate status`
- **Never runs** during `gate scan`, pre-commit hooks, or `gate fix`
- **Never auto-updates** — shows the available version and the command to update
- Respects `--offline` flag and `GATE_OFFLINE=1` env var
- The check is a single HTTPS GET to the npm registry (public, no auth needed)
- Cached for 24 hours in `~/.gate/update-check.json` to avoid repeated requests

### Rule signing in open-source context

The FORTRESS rule signing system is retained but adapted for open source:

- The signing key is used by the project maintainer (Penumbra) when publishing new rule versions
- The key is NOT in the repository — it's held by the maintainer only
- Users who add **custom rules** via `.gaterc` bypass signature verification (custom rules are trusted by definition — the user wrote them)
- The built-in `rules.json` is verified on load: if the signature doesn't match, Gate warns but still loads the rules (degraded mode, not a hard failure)
- This prevents accidental tampering while not breaking forks or local modifications
- `fortress.js` remains in the repo for the maintainer to sign new releases

### Interactive TUI dependency

The interactive mode (`interactive.js`) uses Node.js built-in `readline` module with raw mode (`process.stdin.setRawMode(true)`) for single-keypress input. This is sufficient for the described UX:

- Single character selection (`f`, `i`, `a`, `s`, etc.) — no Enter key needed
- Arrow key navigation is NOT required (options are selected by letter, not cursor)
- Color and formatting use ANSI escape codes directly (no dependency needed)
- When stdin is not a TTY (piped, CI), interactive mode is disabled and Gate falls back to non-interactive output

No additional dependency (inquirer, prompts, etc.) is needed. Raw readline with ANSI codes covers the entire interactive UX.

### Phase 3 dashboard — separate spec

Phase 3 (Dashboard Rebuild) is explicitly **out of scope** for this spec. It will receive its own design spec when Phases 1-2 are complete. The architecture is:

- Lightweight HTTP server in `src/cli/serve.js` (not Express — use Node's built-in `http` module or a minimal framework)
- Reads from `~/.gate/audit.jsonl` and `~/.gate/incidents/`
- No database (flat-file or SQLite via `better-sqlite3`)
- No authentication (local-only, listens on `127.0.0.1`)
- Static frontend (vanilla JS or lightweight framework — decision deferred to Phase 3 spec)
- `gate serve` starts the server and opens the default browser

Until Phase 3 ships, `gate serve` prints: `Dashboard coming in Gate v2.1. Use gate audit and gate report for now.`

---

## Testing Strategy

Every feature ships with comprehensive tests. No exceptions. Edge cases are first-class test targets — they're where real users hit real problems.

### Test framework

- **Jest** for all tests (already in use, no new dependency)
- All tests in `src/cli/__tests__/` mirroring the module structure
- Tests run via `npm test` (must pass before any release)

### Test matrix by module

#### Scanner (`scanner.test.js`)

| Test | What it covers |
|---|---|
| Detects every rule category | Run each of the 300+ rules against a known-positive sample |
| No false positives on safe code | Scan Gate's own source code — must produce zero findings |
| Entropy threshold respects per-file-type settings | .js at 4.0, .env at 3.8, .min.js at 4.5 |
| Handles empty files | No crash, no findings |
| Handles binary files | Detected and skipped correctly |
| Handles files with mixed encodings | UTF-8, ASCII, files with BOM |
| Handles very large files (>10MB) | Completes in reasonable time, no memory issues |
| Handles files with very long lines (>10K chars) | No regex catastrophic backtracking |
| Handles files with no newline at end | Scans last line correctly |
| Incremental scanning (diff-only) | Only scans changed lines, not entire file |
| Inline `gate-ignore` suppression | Suppresses finding on that line only |
| Custom rules from `.gaterc` | Custom patterns are loaded and applied |
| Rule signature verification | Valid sig passes, tampered sig warns, missing sig warns |

#### Config (`config.test.js`)

| Test | What it covers |
|---|---|
| No `.gaterc` → smart defaults | All defaults applied correctly |
| Valid `.gaterc` loads | YAML parsed, settings override defaults |
| Invalid `.gaterc` YAML | Graceful error message, falls back to defaults |
| `.gaterc` with unknown keys | Ignored without crashing (forward-compatible) |
| Severity overrides | `sentry-dsn: ignore` actually suppresses findings |
| Custom rules parsed | Custom rule patterns compile and match |
| Malformed custom rule pattern | Error message identifying which rule is broken |
| `.gaterc` in parent directories | NOT searched (only project root) — explicit decision |

#### Ignore (`ignore.test.js`)

| Test | What it covers |
|---|---|
| No `.gateignore` → no suppression | All findings reported |
| Glob patterns match correctly | `test/fixtures/**` skips all files in fixtures |
| `[rule:X] glob` syntax | Suppresses specific rule in specific path |
| Inline `gate-ignore` | Suppresses the line |
| Inline `gate-ignore: reason` | Reason is recorded in audit log |
| `.gateignore` with comments | Comments are ignored |
| `.gateignore` with blank lines | Blank lines are ignored |
| Invalid glob patterns | Graceful error, line skipped |

#### Fixer (`fixer.test.js`)

| Test | What it covers |
|---|---|
| JS: `const x = "secret"` | Rewrites to `process.env.X` |
| JS: `let x = 'secret'` | Single quotes handled |
| JS: `{ key: "secret" }` | Object property rewritten |
| JS: template literal with secret | Handled or reported as manual fix |
| JS: `module.exports = { key: "secret" }` | Module exports rewritten |
| TS: same patterns as JS | TypeScript files handled identically |
| Python: `x = "secret"` | Rewrites to `os.environ["X"]` |
| Python: adds `import os` | Only if not already present |
| Go: `x := "secret"` | Rewrites to `os.Getenv("X")` |
| Go: adds `"os"` import | Only if not already present |
| Ruby: `x = "secret"` | Rewrites to `ENV["X"]` |
| Java: `String x = "secret"` | Rewrites to `System.getenv("X")` |
| YAML: `key: secret` | Rewrites to `key: ${X}` |
| Dockerfile: `ENV X=secret` | Rewrites to `ARG X` |
| JSON: cannot use env vars | Extracts to `.env`, provides manual note |
| Creates `.env` when missing | File created with header comment |
| Appends to existing `.env` | Does not overwrite existing variables |
| `.env` variable name conflict (same value) | No-op, just updates code reference |
| `.env` variable name conflict (different value) | Warns, uses suffixed name, code matches |
| Adds `.env` to `.gitignore` | Only if not already there |
| `.gitignore` already has `.env` | No duplicate entry |
| Dotenv injection (JS) | Adds `require('dotenv').config()` only once, only in entry file |
| Dotenv already present | No duplicate import |
| ESM project (`"type": "module"`) | Uses `import 'dotenv/config'` instead of require |
| Read-only file | Graceful error, not a crash |
| File deleted between scan and fix | Graceful error |
| Dry run mode | No files modified, output matches what fix would do |
| Undo after fix | All files restored to pre-fix state |
| Undo with created files | Created files are deleted |
| Undo with no snapshots | Helpful error message |
| Multiple fixes then undo | Undoes most recent fix only |
| Fix verification | Re-scan confirms finding is resolved |
| Fix verification catches remaining finding | Reports it, does not re-stage |

#### Verify (`verify.test.js`)

Tests use mocked HTTP responses (never hit real provider APIs in tests):

| Test | What it covers |
|---|---|
| AWS key → verified live | Mocked STS response, status: live |
| AWS key → verified inactive | Mocked 403, status: inactive |
| GitHub PAT → verified live | Mocked /user response |
| Stripe key → live vs test detection | Mocked /v1/balance response |
| Provider timeout (>2s) | Verification marked as "timeout", finding unaffected |
| Total budget exceeded (>5s) | Remaining verifications skipped |
| No network available | All verifications skipped silently |
| Unknown provider | No verification attempted, marked "unverified" |
| Verification cache hit | Second scan uses cached result within TTL |
| Verification cache expired | Re-checks after TTL |
| `--no-verify` flag | No network calls made |
| Parallel execution | Multiple verifications run concurrently |

#### Interactive (`interactive.test.js`)

Tests use mocked stdin/stdout:

| Test | What it covers |
|---|---|
| Single finding → fix | Simulates `f` keypress, verify fixer is called |
| Single finding → skip | Simulates `s` keypress, finding is skipped |
| Single finding → ignore | Simulates `i` keypress, `.gateignore` updated |
| Single finding → explain | Simulates `?` keypress, full guide displayed |
| Multiple findings → fix all | Simulates `f` from main menu |
| Multiple findings → interactive | Walks through each finding |
| Non-TTY stdin | Falls back to non-interactive mode |
| CI environment detected | Non-interactive mode, no prompts |

#### Incident (`incident.test.js`)

| Test | What it covers |
|---|---|
| Exposure: LOCAL | Only extract options shown, no rotation |
| Exposure: COMMITTED | Amend option shown |
| Exposure: PUSHED | Full incident response offered |
| Exposure: UNKNOWN | Defaults to potentially exposed |
| Incident record created | JSON file written to `~/.gate/incidents/` |
| Incident report generation | Markdown output validates structure |
| Provider CLI detection | `which` mock returns found/not-found |
| Rotation command generation | Correct command for each provider |

#### Reporter (`reporter.test.js`)

| Test | What it covers |
|---|---|
| Markdown report generation | Valid Markdown with all sections |
| HTML report generation | Valid HTML document |
| JSON output format | Parseable JSON, all fields present |
| SARIF output format | Validates against SARIF 2.1.0 schema |
| Report with zero findings | Generates successfully (not an error) |
| Report with mixed severities | Counts are correct |
| Compliance mappings present | OWASP/NIST/CIS/SOC2 references in output |
| Incident report | Timeline and actions rendered correctly |

#### Installer (`installer.test.js`)

| Test | What it covers |
|---|---|
| Pre-commit hook install | `.git/hooks/pre-commit` created with correct content |
| Pre-push hook install | `.git/hooks/pre-push` created |
| Hook already exists (gate) | Updated in place |
| Hook already exists (other tool) | Gate appends, does not overwrite |
| Uninstall | Hook removed cleanly |
| Not a git repo | Helpful error message |
| `.git/hooks/` directory missing | Created automatically |
| Permissions set correctly | Hook is executable (chmod +x) |

#### Audit (`audit.test.js`)

| Test | What it covers |
|---|---|
| Scan recorded to audit log | Entry appended to `audit.jsonl` |
| Integrity chain valid | SHA-256 chain verifies |
| Integrity chain tampered | Verification detects tampering |
| Query by date range | `--since` and `--until` filter correctly |
| Export to JSON | Valid JSON array output |
| Empty audit log | Commands work without errors |
| Corrupt audit log entry | Skipped with warning, rest of log still readable |

#### Init (`init.test.js`)

| Test | What it covers |
|---|---|
| Node.js project detected | `package.json` → Node defaults |
| Python project detected | `requirements.txt` → Python defaults |
| Go project detected | `go.mod` → Go defaults |
| Multiple languages | All detected and reported |
| Not a git repo | Error message suggests `git init` |
| `.gateignore` created | Contains stack-appropriate defaults |
| `.env` added to `.gitignore` | Added if not present |
| `.gitignore` doesn't exist | Created with `.env` entry |

#### Output (`output.test.js`)

| Test | What it covers |
|---|---|
| Color output on TTY | ANSI codes present |
| No color when `--no-color` | Zero ANSI codes in output |
| No color when `NO_COLOR=1` | Zero ANSI codes in output |
| Code context rendering | Correct lines shown with line numbers |
| Finding underline positioning | Underline matches the secret position |
| Severity labels | CRITICAL/HIGH/MEDIUM/LOW rendered correctly |
| Verification badges | LIVE/INACTIVE/UNVERIFIED shown |
| CI mode (GitHub Actions) | Uses `::error` annotations |

### Integration tests (`test/`)

End-to-end tests that exercise the full workflow:

| Test | What it covers |
|---|---|
| Full scan → find → fix → re-scan → clean | Complete happy path |
| `npx gate` in fresh git repo | Hook installed, status shown |
| `gate init` in Node.js project | Config created, hook installed |
| `gate scan` with no findings | Clean exit, success message |
| `gate scan` with findings | Correct output format, exit code 1 |
| `gate fix` on multi-language repo | Each language fixed correctly |
| `gate fix --dry-run` → `gate fix` | Dry run matches actual fix |
| `gate fix` → `gate fix --undo` | Files restored perfectly |
| `gate scan --history 10` | Historical findings reported |
| `gate report` generation | Report file created and valid |
| `gate vault keygen` → `encrypt` → `decrypt` | Round-trip works |
| `gate status` | All fields populated correctly |
| Pre-commit hook blocks commit with secret | Commit rejected, findings shown |
| Pre-commit hook allows clean commit | Commit succeeds |
| `.gateignore` suppresses finding | Finding not reported |
| `.gaterc` custom rule matches | Custom pattern detected |
| SARIF output validates | Against SARIF 2.1.0 JSON schema |

### Performance tests

| Test | Threshold |
|---|---|
| Scan 20 files (typical commit) | < 2 seconds |
| Scan 100 files (large commit) | < 5 seconds |
| Scan 1000 files (full repo) | < 30 seconds |
| Rule loading (300+ rules) | < 100ms |
| Entropy calculation (10K strings) | < 500ms |
| No regex catastrophic backtracking | All rules complete in < 10ms per line |

### Test infrastructure

- All filesystem tests use temporary directories (`os.tmpdir()`) — never modify the real repo
- All git tests create temporary git repos with `git init`
- All network tests mock HTTP responses — never hit real APIs
- All stdin/stdout tests mock the terminal — no real TTY interaction
- Tests clean up after themselves (no leaked temp files)
- CI runs the full test suite on Node 18, 20, 22 (the supported versions)

---

## Non-Goals

- Cloud/SaaS hosting — Gate runs locally
- User accounts or authentication — not needed
- Telemetry or analytics — Gate phones home for nothing
- Repository scraping / org-wide scanning — different problem space
- Honeytokens — requires cloud infrastructure, revisit if Gate gets traction
- AST-based code parsing — pattern-based rewriting is sufficient and keeps Gate dependency-free
- Windows-specific optimizations — Gate works on Windows via Node.js but interactive raw mode may have edge cases (documented, not blocked)

---

## Success Criteria

Gate v2 is successful when:
1. `npx gate` in any git repo installs protection in under 3 seconds
2. Zero false positives on Gate's own source code (the current entropy issue is fixed)
3. Every finding includes actionable remediation (not just "we found something")
4. Auto-fix works correctly for JS/TS/Python/Go/Ruby/Java/YAML/Docker/Terraform
5. Credential verification correctly identifies live vs inactive credentials for the top 10 providers
6. The entire CLI works with zero configuration and zero internet access (verification is optional)
7. All 300+ rules have remediation guidance and compliance mappings
8. The incident response workflow handles the full lifecycle: rotate → audit → clean → document
9. A developer can go from zero to protected in one command
10. Pre-commit hook completes in under 2 seconds for typical commits (< 20 files) without verification
11. `gate fix --undo` reliably reverts any auto-fix
12. SARIF output validates against the SARIF 2.1.0 schema
13. Gate's only runtime dependency beyond Node.js built-ins is `js-yaml`
