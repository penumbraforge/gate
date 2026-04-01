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
# Settings > Actions > General > Allow all actions
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
  - uses: actions/checkout@v4
  - run: npm install -g @penumbraforge/gate
  - uses: penumbraforge/gate@v2
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
# Settings > Secrets and variables > Actions > SLACK_WEBHOOK

# Check channel permissions
# Verify @slackbot can post in target channel
```

---

### False Positives (Too Many Findings)

**Symptom:** Legitimate code flagged as security issue

**Solutions:**

1. **Add to `.gateignore`:**

```gitignore
# Ignore documentation examples
docs/example.md

# Rule-scoped suppression
[rule:aws-secret-key] docs/**
```

2. **Suppress rule via `.gaterc`:**

```yaml
severity:
  high-entropy-string: low
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

1. **Only fail on critical findings:**

```yaml
with:
  fail-on: critical
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

1. **Optimize scanning with `.gateignore`:**

```gitignore
node_modules/**
.git/**
dist/**
vendor/**
```

2. **Run on larger runner:**

```yaml
runs-on: ubuntu-latest-xl
```

---

### Inconsistent Results

**Symptom:** Same commit produces different findings in different runs

**Causes:**
- Rules version changed between runs
- Temporary state corruption

**Solutions:**

1. **Pin action version:**

```yaml
uses: penumbraforge/gate@v2
```

2. **Check commit hash:**

Verify you're scanning the same code:

```bash
git log -1 --format=%H
```

---

### Configuration File Not Loaded

**Symptom:**
- `.gaterc` changes ignored
- `.gateignore` not working

**Causes:**
- File not committed
- Wrong location (not in project root)
- YAML/JSON syntax error
- File name typo

**Solutions:**

```bash
# Verify file exists
git ls-files | grep '.gaterc\|.gateignore'

# Validate YAML
cat .gaterc

# Ensure in root directory
ls -la .gaterc .gateignore

# Check committed
git status
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

**Solutions:**

Add exclusions to `.gateignore`:
```gitignore
node_modules/**
.git/**
vendor/**
dist/**
```

Or split workflow to scan only changed paths:

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - 'config/**'
```

---

## Debugging

### Enable Debug Logging

```yaml
env:
  DEBUG: "1"
```

### View Full Logs

```bash
gh run view [run-id] --log
```

### Check GitHub Actions Status

```bash
gh run list --repo=owner/repo
gh run view [run-id]
```

---

## Getting Help

### Before Reporting

1. Check troubleshooting guide (this file)
2. Enable debug logging
3. Verify configuration syntax
4. Check GitHub Actions logs

### Report Issue

Include:
- Workflow YAML (sanitize secrets)
- Configuration files
- GitHub Actions run log
- Error message (complete)
- Reproduction steps

### Support Channels

- GitHub Issues: https://github.com/penumbraforge/gate/issues
- Documentation: https://github.com/penumbraforge/gate/blob/main/GUIDE.md
- Community: https://github.com/penumbraforge/gate/discussions
- Email: support@penumbraforge.com

---

## Common Mistakes

Don't:
- Hardcode secrets in workflow
- Commit sensitive data to test findings
- Use `always()` to override failures
- Ignore warnings

Do:
- Use GitHub secrets: `${{ secrets.NAME }}`
- Use test fixtures for scanning
- Review and address findings
- Monitor audit logs
- Enable notifications
- Document exceptions in `.gateignore`

---

## Performance Benchmarks

| Repo Size | Files | Time | CPU |
|-----------|-------|------|-----|
| Small (< 50) | 50 | 5-10s | Low |
| Medium (50-500) | 500 | 15-30s | Medium |
| Large (500+) | 1000+ | 30-60s | High |

---

If your issue isn't listed, please:
1. Check logs with `DEBUG=1`
2. Report with full context
3. Include reproduction steps
