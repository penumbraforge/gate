# Gate GitHub Action - Production Deployment

## Overview

This is the official **Gate Security Scanner GitHub Action** - a production-ready integration for enforcing security scanning on pull requests and pushes.

**Version**: 1.0.0  
**Status**: ✅ Production Ready  
**Support**: Active  

## What's Included

### Core Files

| File | Purpose |
|------|---------|
| `action.yml` | GitHub Action definition |
| `action.js` | Main action logic (20KB, ~600 lines) |
| `package.json` | Dependencies & scripts |
| `LICENSE` | MIT License |
| `.gitignore` | Git ignore rules |

### Documentation

| File | Purpose |
|------|---------|
| `README.md` | User guide & quick start |
| `CONFIGURATION.md` | Complete configuration guide |
| `TROUBLESHOOTING.md` | Common issues & solutions |
| `SECURITY.md` | Security best practices |
| `DEVELOPMENT.md` | Developer & contributor guide |
| `CHANGELOG.md` | Version history |
| `PRODUCTION.md` | This file - deployment guide |

### Examples

| File | Purpose |
|------|---------|
| `examples/gate-enforce.yml` | Enforce mode workflow |
| `examples/gate-report.yml` | Report mode workflow |
| `examples/gate-scheduled.yml` | Scheduled scan workflow |
| `examples/gate-matrix.yml` | Matrix testing workflow |
| `examples/.gate.json` | Example configuration |
| `examples/.gate-allowlist.json` | Example allowlist |

### Tests

| File | Purpose |
|------|---------|
| `test/action.test.js` | Unit tests (14KB, 40+ tests) |
| `test/action.integration.test.js` | Integration tests (11KB, 20+ tests) |

## Quick Start (5 Minutes)

### 1. Copy Workflow File

```bash
mkdir -p .github/workflows
curl -o .github/workflows/gate.yml \
  https://raw.githubusercontent.com/penumbra/gate-github-action/main/examples/gate-enforce.yml
```

Or manually create `.github/workflows/gate.yml`:

```yaml
name: Gate Security Scan
on: [pull_request, push]

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

### 2. Add Slack Webhook (Optional)

```bash
# Get webhook: https://api.slack.com/messaging/webhooks
# Add to GitHub: Settings → Secrets → SLACK_WEBHOOK
```

### 3. Push to Main Branch

```bash
git add .github/workflows/gate.yml
git commit -m "Add Gate security scanning"
git push origin main
```

### 4. Trigger Workflow

Create a PR - Gate will automatically scan it!

## Features at a Glance

### ✅ Security Scanning
- Scans all files in PR/push
- Detects secrets, misconfigs, compliance violations
- Blocks unsafe commits (configurable)

### ✅ GitHub Integration
- Posts PR comments with findings
- Requests changes on critical issues
- Integrates with GitHub Actions

### ✅ Slack Notifications
- Real-time alerts on violations
- Rich formatting with action buttons
- Bypass attempt notifications

### ✅ Flexible Enforcement
- **Enforce mode**: Fails CI, blocks merge
- **Report mode**: Just logs, doesn't block
- **Configurable severity** levels

### ✅ False Positive Handling
- Allowlist via `.gate-allowlist.json`
- Per-file, per-rule exceptions
- Glob pattern support

### ✅ Audit & Compliance
- Searchable audit logs
- Bypass tracking & detection
- JSON-formatted audit trail

### ✅ Enterprise Features
- License verification
- Team-based overrides
- Custom rule support (roadmap)

## Configuration Files

### `.gate.json` (Optional)

Repository-level configuration:

```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "notify_security": true,
  "rules_version": "v1.2.3",
  "allowed_patterns": [
    {
      "file": "docs/**/*.md",
      "rule": "aws-secret-key",
      "comment": "Documentation examples"
    }
  ]
}
```

### `.gate-allowlist.json` (Optional)

Allowlist specific findings:

```json
[
  {
    "file": "test/fixtures/example.env",
    "rule": "db-password-exposed",
    "comment": "Test fixture"
  }
]
```

## Deployment Checklist

### Phase 1: Setup (Week 1)

- [ ] Add workflow file to `.github/workflows/gate.yml`
- [ ] Set up Slack webhook (optional but recommended)
- [ ] Add GitHub secret: `SLACK_WEBHOOK`
- [ ] Create `.gate.json` (if custom config needed)
- [ ] Test on feature branch (PR)
- [ ] Review findings and baseline

### Phase 2: Soft Enforcement (Week 2)

- [ ] Switch to `report` mode (don't block CI)
- [ ] Enable Slack notifications
- [ ] Create `.gate-allowlist.json` for real false positives
- [ ] Monitor for 3-5 days
- [ ] Document exceptions

### Phase 3: Hard Enforcement (Week 3+)

- [ ] Switch to `enforce` mode
- [ ] Set `failure-mode: block`
- [ ] Update team documentation
- [ ] Post announcement to team Slack
- [ ] Monitor compliance metrics

### Ongoing

- [ ] Review audit logs weekly
- [ ] Update allowlist as needed
- [ ] Track bypass attempts
- [ ] Monitor scan performance
- [ ] Plan rule updates

## Testing

### Run Tests Locally

```bash
npm install
npm test                  # Run all tests
npm run test:coverage     # With coverage report
npm run test:watch       # Watch mode
```

### Manual Testing

```bash
# Create test branch
git checkout -b test/gate-scanning

# Add test file with mock secret
echo 'AWS_SECRET=AKIAIOSFODNN7EXAMPLE' > config.js

# Create PR
git push origin test/gate-scanning

# Gate will automatically scan it
# Check PR comments for findings
```

### Integration Testing

```bash
# Test on specific branches
git checkout -b test/enforce
git push origin test/enforce

# Should block if enforce mode
# Should warn if report mode
```

## Performance & Monitoring

### Benchmarks

| Repo Size | Time | CPU |
|-----------|------|-----|
| Small (< 50 files) | 5-10s | Low |
| Medium (50-500 files) | 15-30s | Medium |
| Large (500+ files) | 30-60s | High |

### Monitoring

**GitHub Actions**:
```bash
gh run list --repo=owner/repo
gh run logs [run-id]
```

**Audit Logs**:
```bash
gh run logs [run-id] | grep "Gate Audit Log"
```

**Slack**:
- Check #security channel for alerts
- Monitor bypass attempts
- Review finding trends

## Success Metrics

Track these metrics:

- **Blocks prevented**: How many PRs were blocked (security wins)
- **False positives**: How often allowlist is needed (tuning needed)
- **Bypass attempts**: Any suspicious activity
- **Mean time to remediate**: How fast developers fix findings
- **Coverage**: % of PRs scanned

## Scaling & Operations

### Multi-Repository Deployment

Use GitHub organization secrets:

1. Create org secret: `SLACK_WEBHOOK`
2. All repos use: `${{ secrets.SLACK_WEBHOOK }}`
3. Centralized secret management

### Large-Scale Deployments

For 100+ repositories:

1. Use GitHub Actions templates:
```bash
gh repo clone org/template-repo .
# Copy .github/workflows/ to all repos
```

2. Automated sync via script:
```bash
for repo in $(gh repo list org --json name); do
  # Copy workflow file
  # Commit and push
done
```

### Performance Optimization

For slow scans:

```json
{
  "exclude_patterns": [
    "node_modules/**",
    ".git/**",
    "vendor/**"
  ],
  "max_parallel_rules": 4
}
```

## Troubleshooting Production Issues

### Gate Not Installing

```bash
# Check in workflow logs
# Solution: Run before Gate
- run: npm install -g @penumbra/gate
```

### High False Positives

```bash
# Start in report mode
mode: report
failure-mode: warn

# Build allowlist over 1-2 weeks
# Then switch to enforce
```

### Slack Notifications Not Working

```bash
# Verify webhook
curl -X POST $SLACK_WEBHOOK -d '{"text":"test"}'

# Check GitHub secret is set
# Verify channel permissions
```

### Performance Issues

```json
{
  "exclude_patterns": ["node_modules/**", ".git/**"],
  "max_file_size": 5000000
}
```

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for more.

## Support & Resources

### Documentation

- 📚 [README.md](README.md) - User guide
- ⚙️ [CONFIGURATION.md](CONFIGURATION.md) - Complete config guide
- 🐛 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues
- 🔒 [SECURITY.md](SECURITY.md) - Security best practices
- 👨‍💻 [DEVELOPMENT.md](DEVELOPMENT.md) - Developer guide

### Community

- 💬 [Slack Community](https://github.com/penumbra/gate/discussions)
- 🐛 [GitHub Issues](https://github.com/penumbra/gate/issues)
- 📚 [Gate Documentation](https://gate.penumbraforge.com/docs)

### Support

- Enterprise: support@penumbraforge.com
- Security Issues: security@penumbraforge.com
- Community: dev@penumbraforge.com

## Upgrade & Maintenance

### Staying Updated

Recommended version strategy:

```yaml
# Pinned to v1 (recommended)
uses: penumbra/gate@v1
# Gets: v1.0.0 → v1.1.0 → v1.2.0 (minor/patch)

# Specific version (most stable)
uses: penumbra/gate@v1.0.0
# Requires manual updates

# Latest (bleeding edge, not recommended for prod)
uses: penumbra/gate@main
```

### Updating

```bash
# Check for new versions
gh release view --repo penumbra/gate

# Update workflow
sed -i 's/@v1.0.0/@v1.1.0/' .github/workflows/gate.yml

# Test on feature branch first
```

## Security Considerations

See [SECURITY.md](SECURITY.md) for:

- Token management
- Secrets handling
- API security
- Audit compliance
- Threat modeling
- Best practices

## License

MIT License - See [LICENSE](LICENSE)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and features.

---

## Next Steps

1. **Review** [README.md](README.md) for user guide
2. **Configure** using [CONFIGURATION.md](CONFIGURATION.md)
3. **Deploy** using checklist above
4. **Test** with examples in `examples/` directory
5. **Monitor** using GitHub Actions and Slack
6. **Adjust** allowlist and settings as needed

## Quick Reference

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

### Full-Featured Workflow

```yaml
name: Gate Security Scan
on:
  pull_request:
    branches: [main, develop]
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

### Configuration Template

```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "notify_security": true,
  "rules_version": "v1.2.3",
  "allowed_patterns": [
    {
      "file": "docs/**",
      "rule": "aws-secret-key",
      "comment": "Documentation examples"
    }
  ]
}
```

---

**Status**: ✅ Production Ready  
**Last Updated**: 2024-01-15  
**Maintainer**: Penumbra Security Team
