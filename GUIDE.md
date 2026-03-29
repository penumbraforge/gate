# Gate — How Everything Works

This is the complete technical guide for Gate v2. It covers every component, how to use it, and how to extend it.

---

## Architecture Overview

Gate is a zero-config secret scanner that runs as a CLI tool. It installs as a git hook and scans files for leaked secrets, API keys, PII, and other sensitive data before they reach your repository.

```
gate/
├── bin/gate.js              # CLI entry point
├── src/
│   └── cli/                 # Scanner modules (pure JS, no build needed)
│       ├── scanner.js       # Core scanning engine
│       ├── rules.js         # 78 built-in rules + rules.json loader
│       ├── config.js        # .gaterc configuration loader
│       ├── ignore.js        # .gateignore pattern matching
│       ├── output.js        # Terminal formatting (color, CI, SARIF)
│       ├── audit.js         # Local audit log with integrity chain
│       ├── installer.js     # Git hook installer (pre-commit + pre-push)
│       ├── init.js          # Interactive project setup
│       ├── status.js        # Health check display
│       ├── remediation.js   # Fix guidance per secret type
│       ├── updater.js       # Self-update checker
│       └── vault.js         # Local AES-256-GCM encryption
├── rules/                   # FORTRESS rule engine (68 detection rules)
│   ├── rules.json           # Detection patterns (cryptographically signed)
│   ├── rules.json.sig       # HMAC-SHA256 signature
│   └── fortress.js          # Rule signing, verification, testing CLI
├── github-action/           # GitHub Action (separate, for Marketplace)
├── test/                    # Integration tests
└── src/cli/__tests__/       # Unit tests
```

### No Server Required

Gate runs entirely on your local machine. There is no database, no Redis, no API server, no dashboard. Everything happens in the CLI:

| Command | What it does |
|---------|-------------|
| `gate` | Install hook (first run) or show status |
| `gate scan` | Scan staged files for secrets |
| `gate scan --all` | Scan all tracked files |
| `gate scan --verify` | Scan and check if credentials are live |
| `gate scan --interactive` | Scan and enter interactive remediation TUI |
| `gate scan --history N` | Scan last N commits for secrets in history |
| `gate scan --format sarif` | Emit SARIF 2.1.0 for GitHub Code Scanning |
| `gate fix` | Auto-remediate all findings (extract to .env) |
| `gate fix --dry-run` | Preview fixes without changing files |
| `gate fix --undo` | Revert the most recent fix |
| `gate report` | Generate Markdown compliance report |
| `gate report --format html` | Generate HTML compliance report |
| `gate report --incident <id>` | Generate incident report for a specific incident |
| `gate purge` | Generate git-filter-repo cleanup script |
| `gate init` | Set up Gate for a project |
| `gate status` | Show installation health |
| `gate vault` | Encrypt/decrypt secrets locally |
| `gate audit` | View or query the audit log |
| `gate install` | Install pre-commit hook |
| `gate uninstall` | Remove pre-commit hook |
| `gate update` | Check for and install updates |
| `gate version` | Show version |

---

## Prerequisites

- **Node.js** >= 18 (tested on 18, 20, 22, 25)

That's it. No PostgreSQL, no Redis, no other services.

---

## Installation

### npm (recommended)

```bash
npm install -g @penumbra/gate
```

### npx (no install)

```bash
cd your-project
npx @penumbra/gate
```

### From source

```bash
git clone https://github.com/penumbra/gate.git
cd gate
npm install
npm link    # makes `gate` available globally
```

### First run

When you run `gate` in a git repository for the first time, it automatically installs the pre-commit hook:

```bash
cd your-project
gate
# -> "Pre-commit hook installed at .git/hooks/pre-commit"
```

On subsequent runs, `gate` shows the status display.

---

## How the Scanner Works

### Detection Pipeline

1. **File Input** — Reads file content line by line
2. **Pattern Matching** — Tests each line against 78 built-in regex rules + 68 rules from `rules/rules.json`
3. **Entropy Analysis** — Calculates Shannon entropy on suspicious tokens (threshold: 4.8 bits/char by default)
4. **Ignore Filtering** — Checks `.gateignore` patterns, rule-scoped suppressions, and inline `gate-ignore` comments
5. **False Positive Filtering** — Skips known safe patterns (test fixtures, example values, common variable names)
6. **Result Aggregation** — Groups findings by file, severity (critical/high/medium/low)

### Rule Categories (FORTRESS Engine)

The `rules/` directory contains the detection rules:
- **`rules.json`** — 281 detection patterns, cryptographically signed
- **`fortress.js`** — Rule signing, verification, and testing CLI
- **`rules.json.sig`** — HMAC-SHA256 signature for tamper detection

Rules cover:
- **Cloud providers** — AWS, GCP, Azure access keys, service accounts, SAS tokens
- **Code platforms** — GitHub, GitLab, Bitbucket tokens and OAuth credentials
- **Communication** — Slack, Discord, Telegram, Twilio tokens
- **Payment** — Stripe, PayPal, Square API keys
- **Databases** — PostgreSQL, MySQL, MongoDB, Redis connection strings
- **Private keys** — RSA, DSA, EC, PGP, SSH keys
- **PII** — SSN, credit cards, passport numbers, email addresses
- **Infrastructure** — Kubernetes, Docker, Terraform, Vault secrets
- **SaaS** — SendGrid, Mailgun, Algolia, Firebase, Supabase, and dozens more

### Output Formats

Gate supports three output formats:

```bash
gate scan                    # text (default) — colored terminal output
gate scan --format json      # JSON — structured output for tooling
gate scan --format sarif     # SARIF — for GitHub Code Scanning / IDE integration
```

### CI/CD Integration

Gate automatically detects CI environments and emits platform-specific annotations:

- **GitHub Actions** — `::error file=...` annotations
- **GitLab CI** — `GL-SAST-REPORT` compatible output

---

## Configuration (.gaterc)

Create a `.gaterc` file in your project root to customize Gate's behavior. Supports YAML or JSON.

### Example .gaterc

```yaml
# Entropy threshold for high-entropy string detection
# Higher = fewer false positives, lower = more sensitive
entropy_threshold: 4.8

# Verify rule signatures on load
verify: true

# Which git hooks to install
hooks:
  - pre-commit
  - pre-push

# Override severity levels for specific rules
severity:
  high-entropy-string: low

# Custom detection rules
rules:
  - id: internal-api-key
    name: Internal API Key
    pattern: "INTERNAL_KEY_[A-Za-z0-9]{32}"
    severity: high
    remediation: Rotate this key in the internal dashboard

# Output settings
output:
  format: text       # text, json, sarif
  color: auto        # auto, true, false
  context_lines: 2   # lines of code context around findings
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `entropy_threshold` | `4.8` | Shannon entropy threshold for high-entropy detection |
| `verify` | `true` | Verify HMAC signature on rules.json |
| `hooks` | `['pre-commit']` | Git hooks to install (`pre-commit`, `pre-push`) |
| `severity` | `{}` | Override severity for rule IDs |
| `rules` | `[]` | Custom detection rules (id, pattern, severity required) |
| `output.format` | `text` | Output format: `text`, `json`, `sarif` |
| `output.color` | `auto` | Color output: `auto`, `true`, `false` |
| `output.context_lines` | `2` | Lines of code context around each finding |

---

## Ignore Patterns (.gateignore)

Create a `.gateignore` file to suppress false positives. Supports glob patterns and rule-scoped suppression.

### Example .gateignore

```gitignore
# Ignore entire directories
node_modules/**
dist/**
test/fixtures/**

# Ignore specific files
docs/examples/fake-credentials.md

# Rule-scoped: only ignore a specific rule in specific files
[rule:high-entropy-string] src/crypto/constants.js
[rule:aws-access-key] test/mocks/**
```

### Pattern Types

| Pattern | Effect |
|---------|--------|
| `path/to/file` | Ignore all findings in this file |
| `dir/**` | Ignore all findings in this directory recursively |
| `*.min.js` | Ignore all findings in minified JS files |
| `[rule:RULE-ID] path` | Ignore only the specified rule in matching files |

### Inline Suppression

You can also suppress findings inline in your source code:

```javascript
const EXAMPLE_KEY = 'sk_test_abc123'; // gate-ignore: test fixture
const API_URL = process.env.API_URL;  // gate-ignore
```

The scanner recognizes `// gate-ignore` and `/* gate-ignore */` comments. Optionally include a reason after the colon.

---

## CLI Commands

### gate scan

Scan files for secrets.

```bash
gate scan                      # scan staged files (pre-commit mode)
gate scan --all                # scan all tracked files
gate scan file1.js file2.py    # scan specific files
gate scan --format json        # JSON output
gate scan --format sarif       # SARIF output
gate scan --no-color           # disable color
gate scan --entropy-threshold 5.0  # custom entropy threshold
```

Exit codes:
- `0` — no findings
- `1` — findings detected (commit should be blocked)

### gate init

Interactive project setup. Detects your stack, creates `.gateignore`, installs hook, updates `.gitignore`.

```bash
gate init
# -> detected: node
# -> .gateignore created
# -> .gitignore updated (env patterns added)
# -> pre-commit hook installed
```

Supported stack detection: Node.js, Python, Go, Ruby, Rust, Java, .NET.

### gate status

Show Gate installation health.

```bash
gate status
```

Displays:
- Hook installation status (pre-commit, pre-push)
- Configuration source (defaults or .gaterc)
- Ignore patterns loaded
- Rule count
- Last scan info
- Audit log summary

### gate vault

Local AES-256-GCM encryption for secrets.

```bash
gate vault keygen              # generate encryption key (~/.gate/vault.key)
gate vault keygen --force      # regenerate key (overwrites existing)
gate vault encrypt "my-secret" # encrypt a value
gate vault decrypt "VAULT:..." # decrypt a vault blob
gate vault env .env            # encrypt all values in a .env file
```

Vault key is stored at `~/.gate/vault.key`. Encrypted values use the format `VAULT:iv:ciphertext:tag`.

### gate audit

View and query the local audit log.

```bash
gate audit                     # show recent entries
gate audit --since 7d          # last 7 days
gate audit --since 2w          # last 2 weeks
gate audit --stats             # aggregate statistics
gate audit --export json       # export full log as JSON
gate audit --verify            # verify integrity chain
gate audit --clear             # delete audit log (requires confirmation)
```

### gate install / uninstall

Manage git hooks.

```bash
gate install                   # install pre-commit hook
gate uninstall                 # remove pre-commit hook
```

### gate update

Check for updates and install them.

```bash
gate update                    # check and install update
gate version                   # show version + update check
```

---

## Audit Trail

Every scan is logged to `~/.gate/audit.jsonl` with:
- Timestamp, commit hash, files scanned
- Findings with severity
- User decision (approved/reported/bypassed)
- SHA-256 integrity chain (each entry hashes the previous)

The integrity chain makes the audit log tamper-detectable. Run `gate audit --verify` to check it.

---

## GitHub Action

The GitHub Action lives in `github-action/` and is published separately to the GitHub Marketplace.

### How It Works

1. Checks out the repo
2. Runs the Gate scanner on changed files
3. Reports findings as PR comments
4. Can block merging (`failure-mode: block`) or just warn (`failure-mode: warn`)
5. Optionally sends Slack notifications

### Usage

```yaml
# .github/workflows/gate.yml
name: Gate Security
on: [pull_request, push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: penumbra/gate@v1
        with:
          mode: enforce           # or 'report'
          failure-mode: block     # or 'warn'
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `report` | `enforce` blocks on findings, `report` just logs |
| `failure-mode` | `block` | `block` fails CI, `warn` passes but alerts |
| `slack-webhook` | --- | Slack webhook URL for notifications |
| `rules-version` | latest | Pin to specific rules version |
| `github-token` | `${{ github.token }}` | For PR comments |

### Action Outputs

| Output | Description |
|--------|-------------|
| `findings-count` | Number of findings detected |
| `blocked` | Whether the commit was blocked |
| `scan-report` | Full JSON scan report |

---

## Testing

```bash
npm test                       # all tests (386+ tests, 18 suites)
npm run test:cli               # CLI tests only
npx jest --watch               # watch mode
npx jest --no-coverage         # skip coverage thresholds
```

### Test Structure

| Suite | Location | Tests |
|-------|----------|:-----:|
| Scanner integration | `test/scanner.test.js` | ~100 |
| Scanner unit | `src/cli/__tests__/scanner.test.js` | ~30 |
| Rules | `src/cli/__tests__/rules.test.js` | ~20 |
| Rules expansion | `src/cli/__tests__/rules-expansion.test.js` | ~20 |
| Config | `src/cli/__tests__/config.test.js` | ~15 |
| Ignore | `src/cli/__tests__/ignore.test.js` | ~15 |
| Output | `src/cli/__tests__/output.test.js` | ~15 |
| Init | `src/cli/__tests__/init.test.js` | ~15 |
| Status | `src/cli/__tests__/status.test.js` | ~15 |
| Installer | `src/cli/__tests__/installer.test.js` | ~15 |
| Audit | `src/cli/__tests__/audit.test.js` | ~15 |
| Self-scan | `src/cli/__tests__/self-scan.test.js` | ~5 |
| Exposure | `src/cli/__tests__/exposure.test.js` | ~20 |
| Verify | `src/cli/__tests__/verify.test.js` | ~20 |
| Fixer | `src/cli/__tests__/fixer.test.js` | ~25 |
| Interactive | `src/cli/__tests__/interactive.test.js` | ~15 |
| Incident | `src/cli/__tests__/incident.test.js` | ~20 |
| Reporter | `src/cli/__tests__/reporter.test.js` | ~20 |
| History | `src/cli/__tests__/history.test.js` | ~20 |

### Coverage Thresholds

| Module | Branches | Functions | Lines | Statements |
|--------|:--------:|:---------:|:-----:|:----------:|
| `src/cli/rules.js` | 100% | 100% | 100% | 100% |
| `src/cli/scanner.js` | 75% | 75% | 80% | 80% |
| Global | 70% | 70% | 75% | 75% |

---

## Security Design

| Layer | Protection |
|-------|-----------|
| **Rules** | HMAC-SHA256 signed, versioned, tamper-detectable |
| **Audit trail** | SHA-256 integrity chain, append-only |
| **Vault** | AES-256-GCM encryption for local secrets |
| **Scanner** | No eval, no dynamic requires, no shell exec |
| **Dependencies** | Single runtime dependency (js-yaml) |
| **Updates** | Version check against npm registry |

---

## File Reference

| Path | Purpose |
|------|---------|
| `bin/gate.js` | CLI entry point — parses commands, dispatches to handlers |
| `src/cli/scanner.js` | Core scanning engine — pattern matching + entropy analysis |
| `src/cli/rules.js` | 78 built-in rules + rules.json loader with signature verification |
| `src/cli/config.js` | .gaterc loader — YAML/JSON config with stack detection |
| `src/cli/ignore.js` | .gateignore loader — glob patterns, rule-scoped suppression, inline ignore |
| `src/cli/output.js` | Terminal output — color, CI annotation, SARIF builder |
| `src/cli/audit.js` | Local audit log (append, query, export, verify, clear) |
| `src/cli/installer.js` | Git hook installer/uninstaller (pre-commit + pre-push) |
| `src/cli/init.js` | Interactive setup — stack detection, .gateignore generation |
| `src/cli/status.js` | Health check — hook status, config, rules, last scan |
| `src/cli/remediation.js` | Per-secret-type fix guidance with links |
| `src/cli/updater.js` | Self-update checker (npm registry) |
| `src/cli/vault.js` | AES-256-GCM keygen, encrypt, decrypt, env-file encryption |
| `src/cli/verify.js` | Credential verification — read-only API calls per provider |
| `src/cli/fixer.js` | Auto-fix engine — extract to .env, rewrite source (9 languages) |
| `src/cli/interactive.js` | Interactive remediation TUI — single-keypress actions |
| `src/cli/incident.js` | Incident response — 5-step guided workflow for PUSHED secrets |
| `src/cli/reporter.js` | Report generation — Markdown, HTML, SARIF 2.1.0, JSON |
| `src/cli/history.js` | Git history scanner + git-filter-repo purge script generator |
| `src/cli/exposure.js` | Exposure assessment — LOCAL / COMMITTED / PUSHED / UNKNOWN |
| `rules/rules.json` | 281 detection patterns (signed) |
| `rules/fortress.js` | Rule engine CLI — sign, verify, test rules |
| `rules/rules.json.sig` | HMAC-SHA256 signature for rules.json |
| `github-action/action.js` | GitHub Action entry point |
| `github-action/action.yml` | Action metadata for Marketplace |

---

## Credential Verification

Gate can make read-only API calls to each provider's own endpoint to confirm whether a detected secret is still active.

```bash
gate scan --verify          # scan + verify detected credentials
gate scan --all --verify    # full-repo scan with verification
```

### How It Works

1. Each finding is matched to a provider (AWS, GitHub, Stripe, GCP, etc.)
2. A read-only API call is made to that provider's identity endpoint (e.g. `GET https://api.github.com/user` with the token as `Authorization: Bearer`)
3. A `401` or `403` means the credential is **revoked** — low priority
4. A `200` or `2xx` means the credential is **live** — critical
5. Results are cached in `~/.gate/verify-cache.json` for 1 hour to avoid redundant API calls

### Timeouts and Budget

- Per-provider timeout: **2 seconds**
- Total verification budget: **5 seconds** across all findings
- If the budget is exceeded, remaining findings are marked `UNVERIFIED`
- Verification results are shown inline next to each finding: `[LIVE]`, `[REVOKED]`, `[UNVERIFIED]`

### Disabling Verification

Verification is opt-in. It only runs when `--verify` is passed explicitly, or when `verify: true` is set in `.gaterc` (and Gate is not running as a pre-commit hook, to avoid slowing commits).

---

## Auto-Fix Engine

Gate can automatically extract secrets from source files into a `.env` file and rewrite the source code to use environment variable references.

```bash
gate fix                   # fix all current findings
gate fix --dry-run         # preview changes without writing files
gate fix --undo            # revert the most recent fix
```

### How It Works

1. Gate scans staged files for secrets
2. For each finding, it identifies the secret value and maps it to a well-known env var name (e.g. `STRIPE_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`)
3. The secret is appended to `.env` (created if absent)
4. The source line is rewritten to reference the env var instead
5. A snapshot is saved to `~/.gate/snapshots/` for undo support

### Language Support

| Language | Extensions | Env Reference |
|----------|-----------|---------------|
| JavaScript / TypeScript | `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx` | `process.env.VAR_NAME` |
| Python | `.py` | `os.environ['VAR_NAME']` (adds `import os` if absent) |
| Go | `.go` | `os.Getenv("VAR_NAME")` (adds `"os"` import if absent) |
| Ruby | `.rb` | `ENV['VAR_NAME']` |
| Java | `.java` | `System.getenv("VAR_NAME")` |
| YAML | `.yml`, `.yaml` | `${VAR_NAME}` |
| Terraform | `.tf` | `var.VAR_NAME` |
| JSON | `.json` | `__ENV_VAR_NAME__` (placeholder) |
| Dockerfile | `Dockerfile` | `$VAR_NAME` (ARG/ENV block) |

### Dry Run

Use `--dry-run` to preview what would change without touching any files:

```bash
gate fix --dry-run
# -> Dry run: 3 finding(s) would be fixed, 1 skipped.
# -> Would rewrite: src/config.js line 12
# -> Would add to .env: STRIPE_SECRET_KEY=sk_live_...
```

### Undo

Snapshots are stored per-fix in `~/.gate/snapshots/`. The `--undo` flag restores the most recent snapshot:

```bash
gate fix --undo
# -> Reverted fix from 2026-03-21T14:22:00Z
```

---

## Interactive Remediation Mode

The interactive TUI presents findings one at a time and accepts single-keypress commands. It uses Node's built-in readline raw mode — no external dependencies.

```bash
gate scan --interactive          # scan and enter interactive mode
gate scan --all --interactive    # full-repo scan, then interactive
```

### How It Works

1. Gate scans files and collects all findings
2. Each finding is shown with file path, line number, matched text, rule name, and severity
3. The exposure level (LOCAL / COMMITTED / PUSHED) is shown alongside
4. A single keypress selects the action

### Available Actions

| Key | Action |
|-----|--------|
| `f` | Fix — extract to `.env`, rewrite source line |
| `i` | Ignore — add inline `// gate-ignore` comment |
| `v` | Vault — encrypt with `gate vault` and replace in source |
| `c` | Copy — copy secret value to clipboard |
| `s` | Skip — leave this finding unchanged (it will appear next scan) |
| `q` | Quit — exit interactive mode |
| `Ctrl+C` | Abort — exit immediately |

When running in a non-TTY environment (CI, pipes), interactive mode falls back to a no-op and prints the findings list.

---

## Incident Response

When a secret has been pushed to a remote repository (exposure level: **PUSHED**), Gate triggers a 5-step guided incident response workflow.

The workflow runs automatically after interactive mode if the exposure is PUSHED, or can be triggered manually:

```bash
# Triggered automatically in interactive mode for PUSHED findings
# Steps are shown one at a time with provider-specific instructions
```

### The 5 Steps

| Step | Name | What happens |
|------|------|-------------|
| 1 | **ROTATE** | Provider-specific instructions to revoke and reissue the credential. Includes CLI commands and web console links. |
| 2 | **AUDIT** | Instructions to review access logs for unauthorized use during the exposure window. |
| 3 | **CLEAN CODE** | Calls the fixer to extract the secret from source files and rewrite to env var reference. |
| 4 | **SCRUB HISTORY** | Generates a `git-filter-repo` script to remove the secret from all git history. |
| 5 | **DOCUMENT** | Creates a formal incident record in `~/.gate/incidents/` and generates a Markdown report. |

Provider-specific guidance is available for: AWS, GitHub, Stripe, GCP, Azure, Heroku, Slack, npm, PyPI, Docker Hub, Datadog, Twilio, SendGrid, and generic providers.

### Incident Records

Incidents are saved as JSON to `~/.gate/incidents/<id>.json`. Use `gate report --incident <id>` to generate a Markdown report from an incident record.

---

## Reports

Gate can generate compliance reports from the audit log or from a specific incident.

```bash
gate report                          # Markdown report to gate-report-YYYY-MM-DD.md
gate report --format html            # HTML report to gate-report-YYYY-MM-DD.html
gate report --incident <id>          # Incident report to gate-incident-<id>.md
```

### Compliance Mappings

Each finding in a report includes compliance framework annotations:

| Framework | Coverage |
|-----------|---------|
| OWASP Top 10 | A02:2021, A05:2021, A07:2021, A08:2021 |
| NIST 800-53 | SC-12, SC-17, IA-5 |
| CIS Controls | CIS 5.2, CIS 14.4 |
| SOC 2 | CC6.1, CC6.2, CC9.2 |

Mappings are defined per rule ID in `src/cli/reporter.js`.

### Report Contents

A compliance report includes:
- Executive summary (findings by severity, files scanned, date range)
- Finding detail table (file, line, rule, severity, compliance mapping)
- Remediation status (fixed / pending / ignored)
- Audit trail summary

---

## SARIF Output

Gate emits [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) for integration with GitHub Advanced Security and IDE plugins.

```bash
gate scan --format sarif                          # print SARIF to stdout
gate scan --format sarif > results.sarif          # save to file
```

### GitHub Advanced Security

Upload SARIF results as a Code Scanning artifact:

```yaml
# .github/workflows/gate.yml
- name: Run Gate
  run: gate scan --all --format sarif > gate.sarif
- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: gate.sarif
```

Findings will appear in the **Security** tab of your repository as Code Scanning alerts.

### SARIF Structure

Gate's SARIF output includes:
- `runs[0].tool.driver.rules` — one rule entry per Gate rule (id, name, shortDescription, helpUri)
- `runs[0].results` — one result per finding (ruleId, message, locations with region)
- Severity mapped to SARIF level: critical/high → `error`, medium → `warning`, low → `note`

---

## Git History Scanning

Gate can scan past commits to find secrets that were introduced (and possibly later removed) from your codebase.

```bash
gate scan --history 50        # scan last 50 commits
gate scan --history 100       # scan last 100 commits
```

### How It Works

1. `git log` retrieves the last N commits in order
2. For each commit, `git diff <hash>^..<hash>` extracts added lines
3. Added lines are scanned with the same pattern+entropy engine as regular scans
4. Findings include the commit hash, date, author, and commit message
5. Duplicates across commits are deduplicated by (file, line content, rule)

For root commits (no parent), `git diff-tree --root` is used.

### Output

```
  Scanned 50 commits — 2 secret(s) found in history:

  [abc1234] 2026-01-15  alice@example.com  "initial config"
    src/config.js  STRIPE_SECRET_KEY  stripe-live-secret  critical

  [def5678] 2026-02-03  bob@example.com  "add payment service"
    src/payment.js  AWS_ACCESS_KEY_ID  aws-access-key-id  critical
```

### Use with Purge

After identifying secrets in history, use `gate purge` to generate the cleanup script (see below).

---

## Purge

When secrets exist in git history, they must be removed from all commits — not just the current files. `gate purge` automates this by generating a `git-filter-repo` script.

```bash
gate purge                    # scan history (default: 50 commits) and generate script
```

### How It Works

1. Runs history scan to find secrets in past commits
2. For each affected file, generates a `git-filter-repo --path-glob` + `--replace-text` command
3. The script is saved to `gate-purge-<timestamp>.sh`
4. You review and run the script manually (it is not executed automatically)

### Running the Script

```bash
# Install git-filter-repo first
pip install git-filter-repo

# Review the generated script
cat gate-purge-<timestamp>.sh

# Run it (DESTRUCTIVE — rewrites git history)
bash gate-purge-<timestamp>.sh

# Force-push rewritten history (coordinate with your team first)
git push --force-with-lease
```

**Note:** Rewriting git history is destructive and requires all collaborators to re-clone. Coordinate with your team and rotate the leaked credentials before running the purge script.

---

## Troubleshooting

### "Not a git repository"

Gate requires a git repository. Initialize one first:
```bash
git init
gate
```

### Hook not running

Make sure the hook is installed and executable:
```bash
gate status              # check hook status
gate install             # reinstall if needed
ls -la .git/hooks/pre-commit
```

### Too many false positives

1. Create a `.gateignore` file with patterns for your project
2. Use rule-scoped ignores: `[rule:high-entropy-string] path/to/file.js`
3. Use inline comments: `// gate-ignore: reason`
4. Adjust entropy threshold: `gate scan --entropy-threshold 5.0`
5. Run `gate init` to auto-detect your stack and generate a starter `.gateignore`

### Self-scan produces findings

If Gate's own source triggers findings, make sure `.gateignore` is present at the project root. Run:
```bash
gate scan --all
```

The `.gateignore` in the Gate repo suppresses known false positives from rule definitions and test fixtures.
