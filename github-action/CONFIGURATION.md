# Gate Action Configuration

This action is a thin wrapper around the Gate CLI. Most behavior is configured with the same project files you already use locally.

## Action Inputs

### `mode`

- `enforce`: intended for merge gates
- `report`: intended for visibility without blocking by default

### `verify`

- `true`: run Gate credential verification for supported providers
- `false`: skip verification

### `format`

- `text`: standard workflow log output
- `json`: keep machine-readable output in `scan-report`
- `sarif`: run an additional SARIF scan and upload it to GitHub Code Scanning

### `fail-on`

Minimum severity that should be treated as actionable:

- `critical`
- `high`
- `medium`
- `low`

### `failure-mode`

- `block`: fail the workflow on actionable findings or scan errors
- `warn`: emit warnings but keep the workflow green

If omitted, Gate derives the behavior from `mode`.

### `slack-webhook`

Optional Slack incoming webhook used for notifications when actionable findings are present.

### `github-token`

Optional token for PR comments and SARIF upload. Defaults to `github.token`.

## Repository Configuration

Use the normal Gate project files:

- `.gaterc` controls custom rules, severity overrides, entropy threshold, output settings, and max file size.
- `.gateignore` controls file exclusions and rule-specific suppressions.

## Example

```yaml
- uses: penumbraforge/gate@v2
  with:
    mode: enforce
    fail-on: high
    failure-mode: block
    verify: true
    format: sarif
    slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```
