# Troubleshooting Guide

## Common Issues & Solutions

### Action Not Running

**Symptom:** Gate workflow doesn't trigger on PR or push  
**Causes:**
- Workflow file not on main branch
- Workflow disabled in repository settings
- Event trigger not matching actual events

**Solutions:**
```bash
# Ensure workflow is on main branch
git add .github/workflows/gate.yml
git commit -m "Add Gate workflow"
git push origin main

# Check workflow is enabled
# Settings → Actions → General → Allow all actions
```

---

### Gate Command Not Found

**Symptom:** 
```
Error: command not found: gate
```

**Causes:**
- Gate not installed
- npm install failed
- PATH not set correctly

**Solutions:**
1. Check network connectivity in runner
2. Verify npm is available: `npm --version`
3. Check run logs for install errors
4. Try manual installation:

```yaml
steps:
  - uses: actions/checkout@v3
  - run: npm install -g @penumbra/gate
  - uses: penumbra/gate@v1
```

---

### Slack Webhook Not Working

**Symptom:** 
- Notifications not appearing in Slack
- No error in logs

**Causes:**
- Invalid webhook URL
- Secret not set correctly
- Channel permissions issue

**Solutions:**
```bash
# Test webhook directly
curl -X POST 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL' \
  -d '{"text":"Test from Gate"}'

# Verify secret is set
# Settings → Secrets and variables → Actions → SLACK_WEBHOOK

# Check channel permissions
# Verify @slackbot can post in target channel
```

---

### License Verification Failed

**Symptom:**
```
⚠️ License verification failed
```

**Causes:**
- License endpoint unreachable
- Invalid license
- Network timeout

**Solutions:**
```json
{
  "skip_license_check": true
}
```

Action continues anyway; this is just a warning.

---

### False Positives (Too Many Findings)

**Symptom:** Legitimate code flagged as security issue

**Solutions:**

1. **Add to allowlist:**

```json
[
  {
    "file": "docs/example.md",
    "rule": "aws-secret-key",
    "comment": "Documentation example"
  }
]
```

2. **Suppress rule globally:**

```json
{
  "excluded_rules": ["false-positive-rule"]
}
```

3. **Review findings:**

Findings might be real! Start in `report` mode to analyze:

```yaml
with:
  mode: report
  failure-mode: warn
```

---

### Too Many Notifications

**Symptom:** Slack flooded with notifications

**Solutions:**

1. **Only notify on critical findings:**

```json
{
  "notify_on_severity": ["CRITICAL", "HIGH"]
}
```

2. **Disable Slack temporarily:**

```yaml
with:
  slack-webhook: ""  # Empty disables notifications
```

3. **Batch notifications:**

Use scheduled scans instead of per-PR:

```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
```

---

### PR Comment Not Posting

**Symptom:** 
- No Gate comment on PR
- Error about permissions

**Causes:**
- Missing permissions
- Token doesn't have write access
- API rate limited

**Solutions:**

1. **Add permissions to workflow:**

```yaml
permissions:
  pull-requests: write
  issues: write
```

2. **Use custom token if needed:**

```yaml
with:
  github-token: ${{ secrets.PAT_TOKEN }}
```

3. **Check API rate limits:**

```bash
gh api rate_limit
```

---

### Action Hangs / Timeout

**Symptom:** 
```
Action timed out after 6 hours
```

**Causes:**
- Large repository (many files)
- Slow rules matching
- Network issues

**Solutions:**

1. **Increase timeout:**

```yaml
env:
  GATE_TIMEOUT: "3600"  # 60 minutes
```

2. **Optimize scanning:**

```json
{
  "exclude_patterns": [
    "node_modules/**",
    ".git/**",
    "dist/**"
  ]
}
```

3. **Run on larger runner:**

```yaml
runs-on: ubuntu-latest-xl
```

---

### Inconsistent Results

**Symptom:** Same commit produces different findings in different runs

**Causes:**
- Rules version not pinned
- Network issues with license check
- Temporary state corruption

**Solutions:**

1. **Pin rules version:**

```yaml
with:
  rules-version: "v1.2.3"
```

2. **Force consistent environment:**

```yaml
env:
  GATE_DEBUG: "true"
```

3. **Check commit hash:**

Verify you're scanning the same code:

```bash
git log -1 --format=%H
```

---

### Configuration File Not Loaded

**Symptom:** 
- `.gate.json` changes ignored
- Allowlist not working

**Causes:**
- File not committed
- Wrong location (not in root)
- JSON syntax error
- File name typo

**Solutions:**

```bash
# Verify file exists
git ls-files | grep '.gate'

# Validate JSON
cat .gate.json | jq .

# Ensure in root directory
ls -la .gate.json

# Check committed
git status
```

---

### Bypass Detection Not Working

**Symptom:** 
- Bypass not detected
- Security team wants stricter enforcement

**Solutions:**

1. **Enable bypass checking:**

```json
{
  "check_bypasses": true,
  "bypass_required_for": ["CRITICAL", "HIGH"]
}
```

2. **Require team approval:**

```json
{
  "security_team": ["@security-leads"],
  "require_approval_count": 2
}
```

3. **Audit all bypasses:**

```bash
gh run logs [run-id] | grep bypass
```

---

### Tests Failing

**Symptom:**
```
Jest test suite failed
```

**Solutions:**

1. **Run tests locally:**

```bash
npm install
npm test
```

2. **Check dependencies:**

```bash
npm ci
npm test -- --verbose
```

3. **Debug specific test:**

```bash
npm test -- --testNamePattern="PR Comments"
```

---

## Performance Issues

### Slow Scans

**Problem:** Scans taking > 60 seconds

**Causes:**
- Large repository
- Many rules to check
- Network latency

**Solutions:**

```json
{
  "exclude_patterns": [
    "node_modules/**",
    ".git/**",
    "vendor/**",
    "dist/**"
  ],
  "max_file_size": 1000000
}
```

Or split workflow:

```yaml
# Scan only changed files in PR
on:
  pull_request:
    paths:
      - 'src/**'
      - 'config/**'
```

---

### High CPU Usage

**Problem:** Gate using 100% CPU

**Solutions:**

1. **Use more resources:**

```yaml
runs-on: ubuntu-latest-xl
```

2. **Limit parallel rules:**

```json
{
  "max_parallel_rules": 4
}
```

3. **Sample large files:**

```json
{
  "sample_large_files": true,
  "max_file_size": 5000000
}
```

---

## Debugging

### Enable Debug Logging

```yaml
env:
  GATE_DEBUG: "true"
```

This logs:
- File scanning details
- Rule matches
- Configuration parsing
- API calls

### View Full Logs

```bash
gh run view [run-id] --log
```

### Extract Audit Log

```bash
gh run logs [run-id] | grep "Gate Audit Log"
```

### Check GitHub Actions Status

```bash
gh run list --repo=owner/repo
gh run view [run-id]
```

---

## Getting Help

### Before Reporting

1. ✅ Check troubleshooting guide (this file)
2. ✅ Enable debug logging
3. ✅ Verify configuration syntax
4. ✅ Check GitHub Actions logs
5. ✅ Review audit logs

### Report Issue

Include:
- Workflow YAML (sanitize secrets)
- Configuration files
- GitHub Actions run log
- Error message (complete)
- Reproduction steps

### Support Channels

- 🐛 GitHub Issues: https://github.com/penumbra/gate/issues
- 📚 Documentation: https://gate.penumbraforge.com/docs
- 💬 Community: https://github.com/penumbra/gate/discussions
- 📧 Enterprise: support@penumbraforge.com

---

## Advanced Debugging

### Mock Testing

```bash
# Test locally without Gate
npm test
```

### Dry Run

```yaml
# Don't fail, just report
with:
  mode: report
  failure-mode: warn
```

### Isolated Testing

Create test branch without action:

```bash
git checkout -b test/gate-debug
git push origin test/gate-debug
# Manually verify behavior
```

### API Testing

```bash
# Test GitHub API access
gh api user
gh api repos/owner/repo

# Test Slack webhook
curl -X POST [webhook-url] -d '{"text":"test"}'
```

---

## Common Mistakes

❌ **Don't:**
- Hardcode secrets in workflow
- Commit sensitive data to test findings
- Use `always()` to override failures
- Ignore warnings
- Skip license verification (without good reason)

✅ **Do:**
- Use GitHub secrets: `${{ secrets.NAME }}`
- Use test fixtures for scanning
- Review and address findings
- Monitor audit logs
- Enable notifications
- Document exceptions

---

## Performance Benchmarks

| Repo Size | Files | Time | CPU |
|-----------|-------|------|-----|
| Small (< 50) | 50 | 5-10s | Low |
| Medium (50-500) | 500 | 15-30s | Medium |
| Large (500+) | 1000+ | 30-60s | High |

---

If your issue isn't listed, please:
1. Check logs with `GATE_DEBUG=true`
2. Report with full context
3. Include reproduction steps
