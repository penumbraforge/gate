[![CI](https://github.com/penumbraforge/gate/actions/workflows/ci.yml/badge.svg)](https://github.com/penumbraforge/gate/actions/workflows/ci.yml)

# Gate

**The first secret scanner that fixes what it finds. For free.**

Gate catches secrets before they're committed, verifies if they're live, and auto-fixes them across 9 languages. It generates compliance reports, incident documentation, and git history purge scripts. No other free tool does this.

## Quick Start

```bash
npx @penumbraforge/gate   # Install pre-commit hook (one command, done)
gate scan --all     # Scan your entire repo
gate fix            # Auto-fix all findings
```

### What happens on first run

```
$ npx @penumbraforge/gate

  ┌─────────────────────────────────────────┐
  │  Gate v2.0.0 — secret scanner + fixer   │
  │                                         │
  │  ✓ Pre-commit hook installed            │
  │  ✓ 146 detection rules loaded           │
  │  ✓ Zero config needed                   │
  │                                         │
  │  Scanning your repo now...              │
  └─────────────────────────────────────────┘

  ✓ Scanned 387 files in 1.2s
```

That's it. Every commit is now protected.

## What Makes Gate Different

| Capability | Gitleaks | TruffleHog | GitHub | GitGuardian | **Gate** |
|---|---|---|---|---|---|
| Detection rules | 170 | 800+ | Partners | 482 | **146** |
| Credential verification | No | Yes | Paid | Paid | **Yes** |
| Auto-fix / extract to env | No | No | No | No | **Yes** |
| Interactive remediation | No | No | No | No | **Yes** |
| Incident response workflow | No | No | No | Paid | **Yes** |
| Compliance reports | No | No | Paid | Paid | **Yes** |
| SARIF output | Yes | Yes | N/A | No | **Yes** |
| 100% free, unlimited | Yes | Yes | Public only | 25 devs | **Yes** |
| Runs 100% locally | Yes | Yes | No | No | **Yes** |

## How It Looks

```
  gate -- 2 secrets found -----------------------------------------

  src/config.js:12
    11   const stripe = require('stripe');
    12   const key = "sk_l****...p7dc";
                      ~~~~~~~~~~~~~~~~~~
    Stripe Live Secret Key -- CRITICAL -- VERIFIED LIVE

    Rotate immediately: https://dashboard.stripe.com/apikeys
```

## All Commands

```
gate scan [path]       Scan files or directories for secrets
gate scan --all        Scan the entire repository
gate scan --staged     Scan only staged files (pre-commit)
gate scan --history    Scan full git history for leaked secrets
gate fix               Auto-fix findings across tracked files
gate fix --staged      Auto-fix staged findings only
gate fix --interactive Single-keypress remediation per finding
gate verify            Check if detected secrets are live
gate incident          Guided 5-step incident response workflow
gate incident report   Generate a saved incident report by ID
gate report            Generate compliance report (OWASP, NIST, CIS, SOC2)
gate install           Install pre-commit hook
gate audit             View local audit log
gate version           Show version
gate help              Show all commands
```

> **Tip:** Run `gate <command> --help` for detailed usage of any command.

## Features

- **146 detection rules** (78 built-in + 68 FORTRESS) -- AWS, GCP, Azure, GitHub, Stripe, OpenAI, Anthropic, databases, private keys, PII, and more
- **Credential verification** -- checks if detected secrets are live and active
- **Auto-fix across 9 languages** -- JS/TS, Python, Go, Ruby, Java, YAML, Terraform, Dockerfile, JSON
- **Interactive remediation** -- single-keypress fix, vault, or ignore per finding
- **Incident response** -- 5-step guided workflow: rotate, audit, clean, scrub, document
- **Compliance reports** -- OWASP, NIST, CIS, SOC2-ready output
- **SARIF output** -- upload results to GitHub Advanced Security
- **Git history scanning** -- find secrets in past commits and generate purge scripts
- **Zero config, zero dependencies, zero accounts** -- runs entirely on your machine

## Installation

```bash
npx @penumbraforge/gate         # Zero-install (runs via npx)
npm install -g @penumbraforge/gate   # Global install
brew install gate               # Homebrew (coming soon)
```

## GitHub Action

```yaml
name: Gate
on: [pull_request, push]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: penumbraforge/gate@v2
        with:
          mode: enforce
          verify: true
          format: sarif
```

## Configuration

Gate works with zero configuration. For customization, create a `.gaterc` file in your project root to adjust severity thresholds, toggle rules, and set scan targets. Use `.gateignore` to exclude files and directories from scanning.

See **[GUIDE.md](GUIDE.md)** for the full technical reference.

## License

Apache 2.0 -- free to use, modify, and distribute, with patent protection. See [LICENSE](LICENSE) for details.

---

Built by [PenumbraForge](https://penumbraforge.com). Free forever.
