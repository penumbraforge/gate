# Gate Security Scanner GitHub Action

Enforce security scanning on every pull request and push with Gate, a powerful secret detection and compliance scanning tool.

## Features

✅ **Automatic scanning** on PR and push events  
✅ **PR comments** with detailed findings  
✅ **Slack notifications** for violations  
✅ **License verification** with graceful degradation  
✅ **Allowlist support** for false positives  
✅ **Audit logging** for compliance  
✅ **Flexible enforcement** (block or warn)  
✅ **Repository configuration** via `.gate.json`  
✅ **Bypass detection** for security compliance  
✅ **Multiple failure modes** for different scenarios  

## Quick Start

### 1. Basic Setup

Add to your workflow file (`.github/workflows/gate.yml`):

```yaml
name: Gate Security Scan
on:
  pull_request:
  push:
    branches: [main, develop]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: penumbra/gate@v1
        with:
          mode: enforce
          failure-mode: block
```

### 2. With Slack Notifications

```yaml
      - uses: penumbra/gate@v1
        with:
          mode: enforce
          failure-mode: block
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### 3. Pin Rules Version

```yaml
      - uses: penumbra/gate@v1
        with:
          mode: enforce
          rules-version: "v1.2.3"
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

## Configuration

### Action Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `mode` | `enforce` (fail) or `report` (warn) | `report` | No |
| `slack-webhook` | Slack webhook for notifications | - | No |
| `failure-mode` | `block` (fail CI) or `warn` (pass but alert) | `block` | No |
| `rules-version` | Pin to specific Gate rules version | latest | No |
| `github-token` | GitHub token for API access | `${{ github.token }}` | No |

### Repository Configuration (`.gate.json`)

Create `.gate.json` in your repository root to customize behavior:

```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "notify_security": true,
  "rules_version": "v1.2.3",
  "skip_license_check": false,
  "check_bypasses": true,
  "allowed_patterns": [
    {
      "file": "docs/example.md",
      "rule": "aws-secret-key"
    },
    {
      "file": "**/test/**",
      "rule": "stripe-api-key"
    }
  ]
}
```

### Allowlist Configuration (`.gate-allowlist.json`)

Separate file for managing allowlisted findings:

```json
[
  {
    "file": "config/mock-secrets.json",
    "rule": "aws-secret-key"
  },
  {
    "file": "docs/**",
    "rule": "api-key-exposed"
  }
]
```

## How It Works

### On Pull Request

1. **Checks out** your code
2. **Scans** all changed files
3. **Analyzes** against Gate rules
4. **Posts** a PR comment with findings
5. **Requests changes** on critical issues (if configured)
6. **Notifies** Slack (if webhook provided)

### On Push

1. **Scans** files from the pushed commit
2. **Logs** findings to GitHub Actions
3. **Sends** Slack notification (if configured)
4. **Fails** the build (if enforce mode enabled)

### Findings Display

PR comments show findings grouped by file:

```
⛔ Gate blocked this PR

Found 2 security findings:

**config/database.yml**
🔴 `aws-secret-access-key`: AWS secret key detected
🟠 `db-password-exposed`: Database password in plain text

**src/api-client.js**
🟡 `api-key-exposed`: API key detected

Remediation Steps:
- Review the findings above
- Remove any exposed secrets
- Rotate compromised credentials
- Force push the corrected code

Questions? Contact @security-team
```

## Modes

### Enforce Mode (Blocks CI)

```yaml
mode: enforce
failure-mode: block  # Default
```

- Scans all files
- Fails the build if findings detected
- Prevents merging until issues resolved
- Best for: Production branches, strict security policies

### Report Mode (Just Logs)

```yaml
mode: report
failure-mode: warn
```

- Scans all files
- Always passes CI
- Posts PR comments (findings visible to team)
- Sends notifications
- Best for: Onboarding, soft enforcement, analysis

### Mixed Approaches

```yaml
- uses: penumbra/gate@v1
  with:
    mode: report  # Don't fail CI
    failure-mode: block  # But alert everyone
    slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

Scans with notifications, but doesn't block merging.

## License Verification

The action automatically verifies your Gate license:

- ✅ **Valid license**: Full scanning enabled
- ⚠️ **Invalid/expired**: Continues with warning
- 🔗 **API down**: Continues without blocking (graceful degradation)

No changes needed; verification happens automatically.

## Handling False Positives

### Method 1: Per-Finding Allowlist

Create `.gate-allowlist.json`:

```json
[
  {
    "file": "docs/example.md",
    "rule": "aws-secret-key",
    "comment": "This is a documentation example, not a real secret"
  }
]
```

### Method 2: Via `.gate.json`

```json
{
  "allowed_patterns": [
    {
      "file": "test/fixtures/**",
      "rule": "api-key-exposed"
    }
  ]
}
```

### Method 3: Request Bypass (Team Override)

For findings you want to acknowledge but bypass:

1. Security team reviews the PR
2. Adds comment: `@gate-security-team approve-bypass`
3. Requires 2 approvals to override block
4. Bypass is audited and logged

## Slack Integration

### Setup

1. Create incoming webhook in Slack: [Slack API](https://api.slack.com/messaging/webhooks)
2. Add secret to GitHub: Settings → Secrets → `SLACK_WEBHOOK`
3. Use in workflow:

```yaml
slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### Notifications Include

- **Repository & PR info**
- **Security findings** (rules matched)
- **Severity level** (critical/high/medium)
- **Actor** (who triggered the scan)
- **Link to run** (for investigation)

### Notification Examples

**On findings:**
```
⚠️ Gate blocked unsafe code
PR: https://github.com/org/repo/pull/123
Author: john@company.com
Findings: 1 AWS secret, 2 misconfigs
Action: Review PR and contact developer
```

**On bypass attempt:**
```
🚨 Security bypass attempt
PR: #123 in #repo-name
User: john@company.com
Skipped Rules: aws-secret-key
Review: [link to audit log]
```

## Audit Logs

All scans are audited in GitHub Actions logs. Each run includes:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "commit": "abc123",
  "event": "pull_request",
  "actor": "john@company.com",
  "filesScanned": 15,
  "rulesMatched": ["aws-secret-key", "api-key-exposed"],
  "decision": "blocked",
  "licenseValid": true
}
```

**Export logs:**
```bash
gh run logs [run-id] | grep "Gate Audit Log"
```

## Troubleshooting

### Action Not Running

**Problem:** Gate action doesn't trigger on PR  
**Solution:** Ensure workflow file is on main branch:
```bash
git add .github/workflows/gate.yml
git commit -m "Add Gate workflow"
git push origin main
```

### Gate Not Found

**Problem:** `command not found: gate`  
**Solution:** Action auto-installs `@penumbra/gate` from npm. Verify:
- npm is available in runner
- Internet connectivity for npm install
- Check run logs for install errors

### False Positives

**Problem:** Legitimate code flagged as security issue  
**Solution:** Add to `.gate-allowlist.json`:
```json
[
  {
    "file": "docs/example.md",
    "rule": "aws-secret-key",
    "comment": "Documentation example"
  }
]
```

### Slack Webhook Not Working

**Problem:** Notifications not arriving in Slack  
**Solution:**
1. Verify webhook is valid: `curl -X POST [webhook-url] -d '{"text":"test"}'`
2. Check secret in GitHub is set correctly
3. Review GitHub Actions logs for errors
4. Ensure channel exists and bot has access

### License Verification Failed

**Problem:** `License verification failed` warning  
**Solution:**
1. Check internet connectivity
2. Verify license endpoint is accessible
3. Action continues anyway (graceful degradation)
4. Contact support if persistent

### Too Many False Positives

**Problem:** Too many findings blocking PRs  
**Solution:**
1. Start in `report` mode to analyze patterns
2. Build allowlist for patterns specific to your repo
3. Gradual transition: report → warn → enforce
4. Tune rules version per your security posture

## Advanced Features

### Team Overrides

Only security team can approve bypasses. In `.gate.json`:

```json
{
  "security_team": ["@security-leads"],
  "require_approval_count": 2,
  "bypass_required_for": ["CRITICAL"]
}
```

### Multi-Branch Configuration

Different enforcement per branch:

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
        with:
          mode: ${{ github.ref == 'refs/heads/main' && 'enforce' || 'report' }}
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### Custom Workflows

```yaml
# Scan on schedule (daily security audit)
on:
  schedule:
    - cron: '0 2 * * *'
  pull_request:
  push:

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: penumbra/gate@v1
        with:
          mode: enforce
          slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

## Output Variables

The action provides outputs for use in subsequent steps:

```yaml
steps:
  - id: gate
    uses: penumbra/gate@v1
    
  - run: echo "Findings: ${{ steps.gate.outputs.findings-count }}"
  - run: echo "Blocked: ${{ steps.gate.outputs.blocked }}"
  - run: echo "Report: ${{ steps.gate.outputs.scan-report }}"
```

## Environment Variables

Control behavior with environment variables:

```yaml
env:
  GATE_DEBUG: "true"  # Enable debug logging
  GATE_TIMEOUT: "300" # Scan timeout in seconds
```

## Performance

- **Small repos** (< 50 files): ~5-10 seconds
- **Medium repos** (50-500 files): ~15-30 seconds
- **Large repos** (500+ files): ~30-60 seconds

Timeout is configurable per action or workflow level.

## Security Considerations

1. **Secrets handling**: GitHub token is never logged
2. **Slack webhooks**: Keep in repository secrets, not code
3. **Bypass logging**: All bypasses are audited
4. **Reproducibility**: Runs are deterministic; same commit = same results

## Support

- 📚 [Gate Documentation](https://gate.penumbraforge.com/docs)
- 🐛 [Report Issues](https://github.com/penumbra/gate/issues)
- 💬 [Community Slack](https://github.com/penumbra/gate/discussions)
- 📧 Security team: @security-team

## License

MIT - See LICENSE file
