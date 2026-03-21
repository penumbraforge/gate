# Configuration Guide

This guide explains how to configure Gate for your repository and CI/CD workflow.

## File Structure

```
.github/workflows/
├── gate.yml                 # Main workflow file
.gate.json                   # Repository configuration
.gate-allowlist.json        # Allowlist for false positives
```

## Action Inputs

### `mode` (string)

**Options:** `enforce` | `report`  
**Default:** `report`

Controls how findings are handled:

- **enforce**: Fails CI if findings detected
- **report**: Always passes CI, but posts comments and notifications

```yaml
with:
  mode: enforce
```

### `failure-mode` (string)

**Options:** `block` | `warn`  
**Default:** `block`

How to treat the CI result:

- **block**: Fails the build (exit code 1)
- **warn**: Passes build but sends notification

```yaml
with:
  failure-mode: block
```

### `slack-webhook` (string)

**Default:** None (optional)

Slack incoming webhook URL for notifications. Set as a GitHub secret:

```yaml
with:
  slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

Get your webhook URL from [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks).

### `rules-version` (string)

**Default:** Latest version

Pin to a specific Gate rules version:

```yaml
with:
  rules-version: "v1.2.3"
```

Useful for:
- Ensuring consistent behavior across runs
- Gradual rule updates
- Handling breaking changes in new rule versions

### `github-token` (string)

**Default:** `${{ github.token }}`

GitHub token for API calls (PR comments, license verification):

```yaml
with:
  github-token: ${{ secrets.CUSTOM_TOKEN }}
```

Usually the default is fine; override only if needed.

## Repository Configuration (`.gate.json`)

Place in repository root to customize behavior.

### Basic Configuration

```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "notify_security": true
}
```

### Complete Configuration

```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "notify_security": true,
  "check_bypasses": true,
  "rules_version": "v1.2.3",
  "skip_license_check": false,
  
  "allowed_patterns": [
    {
      "file": "docs/**/*.md",
      "rule": "aws-secret-key",
      "comment": "Documentation examples"
    }
  ],
  
  "security_team": ["@security-leads"],
  "require_approval_count": 2,
  "bypass_required_for": ["CRITICAL"],
  
  "audit_log": {
    "enabled": true,
    "format": "json"
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `enforce_mode` | boolean | Override action input `mode` |
| `block_on_findings` | boolean | Always block CI on findings |
| `notify_security` | boolean | Always notify on findings |
| `check_bypasses` | boolean | Detect security bypass attempts |
| `rules_version` | string | Override action `rules-version` input |
| `skip_license_check` | boolean | Skip license verification |
| `allowed_patterns` | array | Allowlist false positives |
| `security_team` | array | Team members with bypass approval |
| `require_approval_count` | number | Approvals needed for bypass |
| `bypass_required_for` | array | Severity levels requiring bypass |
| `audit_log` | object | Audit log configuration |

## Allowlist Configuration

### Using `.gate-allowlist.json`

```json
[
  {
    "file": "docs/example.md",
    "rule": "aws-secret-key",
    "comment": "Documentation example"
  },
  {
    "file": "test/fixtures/**",
    "rule": "stripe-api-key",
    "comment": "Test fixtures"
  }
]
```

### Using `.gate.json`

```json
{
  "allowed_patterns": [
    {
      "file": "docs/**",
      "rule": "aws-secret-key",
      "comment": "Documentation"
    }
  ]
}
```

### Pattern Matching

Supports glob patterns:

| Pattern | Matches |
|---------|---------|
| `docs/**` | Any file in docs/ |
| `test/**/*.js` | JavaScript files in test/ |
| `**/secret.yml` | Any secret.yml file |
| `config.js` | Specific file |

## Workflow Configuration

### Minimal Workflow

```yaml
name: Gate
on: [pull_request, push]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
```

### Production Workflow

```yaml
name: Gate Security Scan
on:
  pull_request:
    branches: [main]
  push:
    branches: [main, develop]

jobs:
  gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - uses: penumbra/gate@v1
        with:
          mode: enforce
          failure-mode: block
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
          rules-version: "v1.2.3"
```

### Branch-Specific Enforcement

```yaml
- uses: penumbra/gate@v1
  with:
    mode: ${{ github.ref == 'refs/heads/main' && 'enforce' || 'report' }}
    slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

Enforce on main, report on other branches.

### Multiple Workflows

```yaml
# .github/workflows/gate-enforce.yml
name: Gate Enforce (Main)
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
        with:
          mode: enforce

# .github/workflows/gate-report.yml
name: Gate Report (Feature Branches)
on:
  pull_request:
    branches-ignore: [main]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
        with:
          mode: report
```

## Secrets Setup

### Slack Webhook

1. Create incoming webhook: https://api.slack.com/messaging/webhooks
2. Add to GitHub: Settings → Secrets and variables → Actions → New repository secret
3. Name: `SLACK_WEBHOOK`
4. Value: Your webhook URL
5. Use in workflow: `slack-webhook: ${{ secrets.SLACK_WEBHOOK }}`

### Custom GitHub Token (Optional)

If using custom PAT with restricted permissions:

1. Generate token: https://github.com/settings/tokens
2. Add to GitHub secrets: `GATE_TOKEN`
3. Use in workflow: `github-token: ${{ secrets.GATE_TOKEN }}`

## Environment Variables

Supported environment variables for advanced configuration:

| Variable | Description | Example |
|----------|-------------|---------|
| `GATE_DEBUG` | Enable debug logging | `true` |
| `GATE_TIMEOUT` | Scan timeout in seconds | `300` |
| `GATE_RULES_DIR` | Custom rules directory | `/custom/rules` |
| `GATE_LOG_FORMAT` | Log output format | `json` |

Usage in workflow:

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      GATE_DEBUG: "true"
      GATE_TIMEOUT: "600"
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
```

## Conditional Execution

Run Gate only in specific scenarios:

```yaml
# Only on pull requests
- uses: penumbra/gate@v1
  if: github.event_name == 'pull_request'

# Only on specific branches
- uses: penumbra/gate@v1
  if: github.ref == 'refs/heads/main'

# Only when files changed
- uses: penumbra/gate@v1
  if: github.event.pull_request.changed_files > 0
```

## Gradual Rollout

Transition from report to enforce mode:

### Phase 1: Analyze (Week 1)
```yaml
mode: report
failure-mode: warn
```

### Phase 2: Warn (Week 2-3)
```yaml
mode: report
failure-mode: warn
slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### Phase 3: Enforce (Week 4+)
```yaml
mode: enforce
failure-mode: block
slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

## Best Practices

1. **Start with `report` mode** - Understand findings before enforcing
2. **Build allowlist gradually** - Use `.gate-allowlist.json` for real patterns
3. **Pin rules version** - Control when rule updates take effect
4. **Enable Slack notifications** - Keep team informed
5. **Review audit logs** - GitHub Actions logs contain detailed audit trail
6. **Document exceptions** - Add comments to allowlist entries
7. **Notify team** - Communicate enforcement changes in advance

## Troubleshooting Configuration

### Changes not taking effect

1. Ensure files are in repository root
2. Check syntax (JSON must be valid)
3. Verify file names (case-sensitive on Linux)
4. Commit and push changes
5. Trigger new workflow run

### Actions ignored

1. Verify `.gate.json` is committed (not in `.gitignore`)
2. Check action is up-to-date: `uses: penumbra/gate@v1`
3. Review GitHub Actions logs for errors

### Allowlist not working

1. Check pattern syntax
2. Use glob tester: https://www.digitalocean.com/community/tools/glob
3. Add debug logging: `env: { GATE_DEBUG: "true" }`
4. Verify file paths in allowlist match scan results

## Examples

See `/examples` directory for complete configuration examples:

- `.gate.json` - Full configuration
- `.gate-allowlist.json` - Allowlist examples
- `gate-enforce.yml` - Enforce mode workflow
- `gate-report.yml` - Report mode workflow
- `gate-scheduled.yml` - Scheduled scan workflow
- `gate-matrix.yml` - Matrix testing workflow
