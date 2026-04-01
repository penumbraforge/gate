# Gate GitHub Action

Gate runs the Gate CLI inside GitHub Actions, applies the same `.gaterc` and `.gateignore` settings you use locally, and can either block or warn on findings and incomplete scans.

## Quick Start

```yaml
name: Gate

on:
  pull_request:
  push:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: penumbraforge/gate@v2
        with:
          mode: enforce
          fail-on: high
          failure-mode: block
          verify: true
          format: sarif
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `mode` | `enforce` or `report` | `report` |
| `verify` | Run Gate credential verification for supported providers | `false` |
| `format` | `text`, `json`, or `sarif` | `text` |
| `fail-on` | Minimum actionable severity: `critical`, `high`, `medium`, `low` | `high` |
| `failure-mode` | `block` to fail the workflow, `warn` to emit warnings only | Derived from `mode` |
| `slack-webhook` | Slack incoming webhook for notifications | unset |
| `github-token` | Token used for PR comments and SARIF upload | `${{ github.token }}` |

## Outputs

| Output | Description |
|--------|-------------|
| `findings-count` | Findings at or above the configured threshold |
| `blocked` | Whether the action blocked the workflow |
| `scan-report` | JSON payload containing findings, scan errors, skipped files, and summary data |

## Behavior

- Gate installs `@penumbraforge/gate` on the runner if the CLI is not already available.
- The action makes decisions from `gate scan --all --format json`.
- When `format: sarif` is selected, Gate runs an additional SARIF scan and uploads it to GitHub Code Scanning.
- Scan errors are treated as an incomplete security result. In `failure-mode: block` they fail the workflow; in `warn` mode they emit warnings.
- Repository behavior still comes from the standard Gate files:
  - `.gaterc` for rule, severity, threshold, and output settings
  - `.gateignore` for file and rule exclusions

## Notes

- `mode: enforce` defaults to `failure-mode: block`.
- `mode: report` defaults to `failure-mode: warn`.
- PR comments and Slack notifications are only sent when findings remain at or above the configured threshold.
