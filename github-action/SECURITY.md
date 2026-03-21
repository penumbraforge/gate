# Security Considerations

This document outlines security best practices for using the Gate GitHub Action.

## Data Handling

### What Gate Scans

Gate scans:
- All files in pull requests
- Committed code
- Configuration files
- Documentation

Gate does NOT:
- Access environment variables
- Access GitHub secrets
- Store raw findings in logs (unless debug enabled)
- Transmit source code outside your infrastructure

### Secrets in Logs

The action avoids logging sensitive data:

✅ **Safe:**
- Findings metadata (filename, rule name, severity)
- Counts of issues
- Audit trail

❌ **Avoided:**
- Actual secret content
- File paths containing secrets
- User tokens or passwords

## API Security

### GitHub API

**What's transmitted:**
- Repository name and owner
- PR number
- Changed file list
- GitHub token (encrypted in transit)

**Permissions needed:**
- `contents: read` - Read repository
- `pull-requests: write` - Post PR comments
- `issues: write` - Create issues (optional)

**Best practice:**
```yaml
permissions:
  contents: read
  pull-requests: write
```

### Slack Webhook

**What's transmitted:**
- Finding summaries (not full content)
- PR/repo information
- Severity levels
- Author information

**Security:**
- Keep webhook URL secret (use GitHub secrets)
- Rotate webhook annually
- Monitor Slack audit logs

**Example:**
```yaml
slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
```

### License Verification

**What's transmitted:**
- Repository owner and name
- GitHub token (for verification only)

**Protocol:**
- HTTPS only
- 5-second timeout
- No data stored

**Graceful fallback:**
- If endpoint down: action continues
- If license invalid: warning, action continues
- Safe for disconnected/air-gapped environments

## Token Management

### GitHub Token

**Default token (`${{ github.token }}`):**
- Generated per workflow run
- Limited to current repository
- Expires after job completes
- Safe to use

**Custom token (PAT):**
- Use only if needed for cross-repo access
- Keep in GitHub secrets
- Rotate periodically
- Use minimal scopes

**Never:**
- Commit tokens
- Log tokens
- Put in environment variables
- Pass to external services

### Slack Webhook

**Setup:**
1. Generate webhook in Slack workspace
2. Store in GitHub secrets
3. Reference as `${{ secrets.SLACK_WEBHOOK }}`
4. Rotate if compromised

**Never:**
- Hardcode webhook URL
- Commit webhook URL
- Share in PR description
- Log webhook URL

## Configuration Security

### `.gate.json`

Can be public (no secrets):
```json
{
  "enforce_mode": true,
  "block_on_findings": true,
  "rules_version": "v1.2.3"
}
```

Never include:
- API keys
- Tokens
- Passwords
- Webhook URLs

### `.gate-allowlist.json`

Safe to be public:
```json
[
  {
    "file": "docs/example.md",
    "rule": "aws-secret-key",
    "comment": "Documentation"
  }
]
```

Document why patterns are allowlisted.

## Audit & Compliance

### Audit Logging

All scans are logged with:
- Commit hash
- Files scanned
- Rules matched
- Decision (block/pass)
- Timestamp
- Actor

**Access logs:**
```bash
gh run logs [run-id] | grep "Gate Audit Log"
```

### Compliance Features

✅ **Available:**
- Audit trail in GitHub Actions logs
- Bypass detection and logging
- Decision logging (block/pass)
- Security team override tracking
- Reproducible scans (pinned rules)

### GDPR Compliance

The action:
- Doesn't store personal data
- Doesn't transmit PII (unless in findings)
- Supports ephemeral runners
- Respects data deletion (logs auto-delete)

## Deployment Security

### In Production

```yaml
# Pin to specific version (safer)
uses: penumbra/gate@v1

# Or latest (automatic updates, slightly riskier)
uses: penumbra/gate@main
```

### Self-Hosted Runners

If using self-hosted runners:

1. Keep runner software updated
2. Use private networking
3. Isolate from public internet (optional)
4. Audit runner logs
5. Use per-job cleanup

```yaml
runs-on: [self-hosted, secure-runner]
```

### Air-Gapped Environments

For disconnected networks:

1. Gate can run offline (no external calls required)
2. Cache npm packages: `actions/setup-node@v3` with caching
3. Configure license verification skip:

```json
{
  "skip_license_check": true
}
```

## Threat Model

### Assumptions

- GitHub repository access is trustworthy
- GitHub Actions infrastructure is secure
- npm registry is trustworthy
- Slack workspace is trustworthy

### Mitigations

| Threat | Mitigation |
|--------|-----------|
| Malicious PR | Action blocks it before merge |
| Token leakage | GitHub revokes; timeout limits damage |
| Webhook compromise | Rotate webhook URL; monitor Slack |
| Supply chain (npm) | Use specific version in package.json |
| Configuration tampering | Require code review for `.gate.json` |

## Best Practices

### ✅ Do

- **Use GitHub secrets** for all credentials
- **Pin versions** - especially rules
- **Review findings** - don't auto-allowlist
- **Document exceptions** - why is this allowlisted?
- **Monitor logs** - watch for unexpected patterns
- **Rotate credentials** - annually minimum
- **Use HTTPS** - for all webhooks
- **Enable audit logging** - `audit_log.enabled: true`

### ❌ Don't

- **Hardcode secrets** in workflows or configs
- **Commit tokens** to repository
- **Share webhook URLs** in PRs
- **Use default GitHub token** outside current repo
- **Skip license checks** without good reason
- **Allow-list sensitive rules** without review
- **Ignore bypass attempts** - investigate them
- **Use draft mode** on production branches
- **Log sensitive data** (even for debugging)

## Response to Compromise

### If GitHub Token Leaked

1. Immediate: Action runs will fail (token revoked)
2. Action: Review compromised workflow logs
3. Audit: Check what the token accessed
4. Report: Contact GitHub security

### If Slack Webhook Compromised

1. Immediate: Rotate webhook URL
2. Action: Update GitHub secret with new URL
3. Audit: Review Slack audit logs
4. Monitor: Watch for unauthorized notifications

### If Configuration Tampered

1. Review: Check `.gate.json` and `.gate-allowlist.json` diff
2. Verify: Ensure rules version is correct
3. Audit: Check who made changes
4. Revert: Force push correct configuration
5. Investigate: Why was it changed?

## Reporting Security Issues

If you find a security vulnerability:

1. **Don't** disclose publicly
2. **Email** security@penumbraforge.com
3. **Include** reproduction steps
4. **Allow** 90 days for fix
5. **Coordinated** responsible disclosure

## References

- [GitHub Security Best Practices](https://docs.github.com/en/actions/security-guides)
- [OWASP Secrets Management](https://owasp.org/www-community/Sensitive_Data_Exposure)
- [CWE-798: Hard-Coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [GitHub Token Security](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure)

## Support

Security questions? Contact:
- 🔐 security@penumbraforge.com
- 🐛 GitHub Issues (non-sensitive): https://github.com/penumbra/gate/issues
- 💬 Community: https://github.com/penumbra/gate/discussions
