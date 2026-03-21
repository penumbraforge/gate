'use strict';

/**
 * Incident Response Workflow
 *
 * A 5-step guided incident response for secrets that have been pushed to remote.
 * Matches how real security teams handle credential exposure.
 *
 * Steps:
 *   1. ROTATE   — revoke and reissue the compromised credential
 *   2. AUDIT    — review access logs for unauthorised use
 *   3. CLEAN CODE — remove secret from source files (calls fixer.fixFinding)
 *   4. SCRUB HISTORY — generate git-filter-repo purge script
 *   5. DOCUMENT — create formal incident record and report
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ─── Provider rotation knowledge ─────────────────────────────────────────────

const ROTATION_INFO = {
  aws: {
    cli: 'aws',
    commands: [
      'aws iam delete-access-key --access-key-id <KEY_ID>',
      'aws iam create-access-key --user-name <USER>',
    ],
    webUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    webSteps: 'IAM Console → Users → Security credentials → Access keys → Deactivate/Delete',
    auditUrl: 'https://console.aws.amazon.com/cloudtrail/home',
    auditInstructions: 'CloudTrail → Event history → Filter by Access Key ID. Look for unusual regions, IPs, or service calls.',
  },
  github: {
    cli: 'gh',
    commands: [
      '# Revoke via GitHub API',
      'gh api -X DELETE /user/tokens/<TOKEN_ID>',
    ],
    webUrl: 'https://github.com/settings/tokens',
    webSteps: 'Settings → Developer settings → Personal access tokens → Delete',
    auditUrl: 'https://github.com/settings/security-log',
    auditInstructions: 'GitHub → Settings → Security log. Filter by date range of exposure. Look for unexpected OAuth app authorisations or repo clones.',
  },
  stripe: {
    cli: 'stripe',
    commands: ['stripe api_keys roll <KEY>'],
    webUrl: 'https://dashboard.stripe.com/apikeys',
    webSteps: 'Dashboard → Developers → API keys → Roll key',
    auditUrl: 'https://dashboard.stripe.com/logs',
    auditInstructions: 'Stripe Dashboard → Developers → Logs. Filter by date range. Look for unexpected charges, refunds, or customer data access.',
  },
  gcp: {
    cli: 'gcloud',
    commands: [
      'gcloud iam service-accounts keys delete <KEY_ID> --iam-account=<SA_EMAIL>',
      'gcloud iam service-accounts keys create new-key.json --iam-account=<SA_EMAIL>',
    ],
    webUrl: 'https://console.cloud.google.com/apis/credentials',
    webSteps: 'IAM & Admin → Service accounts → Keys → Delete → Add key',
    auditUrl: 'https://console.cloud.google.com/logs',
    auditInstructions: 'Cloud Logging → Filter: resource.type="service_account". Look for unexpected API calls or data access.',
  },
  azure: {
    cli: 'az',
    commands: [
      'az ad sp credential delete --id <APP_ID> --key-id <KEY_ID>',
      'az ad sp credential reset --id <APP_ID>',
    ],
    webUrl: 'https://portal.azure.com/',
    webSteps: 'Azure Portal → Azure Active Directory → App registrations → Certificates & secrets → Delete → New secret',
    auditUrl: 'https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/SignIns',
    auditInstructions: 'Azure AD → Sign-in logs. Filter by date. Look for sign-ins from unexpected locations or applications.',
  },
  heroku: {
    cli: 'heroku',
    commands: ['heroku authorizations:revoke <TOKEN_ID>'],
    webUrl: 'https://dashboard.heroku.com/account',
    webSteps: 'Account Settings → Applications → Authorizations → Revoke',
    auditUrl: 'https://dashboard.heroku.com/account/security',
    auditInstructions: 'Heroku Dashboard → Account → Security → Recent activity. Look for unexpected deployments or config changes.',
  },
  slack: {
    cli: null,
    webUrl: 'https://api.slack.com/apps',
    webSteps: 'Your Apps → OAuth & Permissions → Regenerate',
    auditUrl: 'https://slack.com/intl/en-gb/help/articles/360047182414',
    auditInstructions: 'Slack Admin → Audit Logs (Enterprise). Filter by date range. Look for unexpected messages, file access, or channel joins.',
  },
  openai: {
    cli: null,
    webUrl: 'https://platform.openai.com/api-keys',
    webSteps: 'API keys → Delete → Create new',
    auditUrl: 'https://platform.openai.com/usage',
    auditInstructions: 'OpenAI Platform → Usage. Check for unexpected API calls, token usage spikes, or requests from unusual user agents.',
  },
  anthropic: {
    cli: null,
    webUrl: 'https://console.anthropic.com/settings/keys',
    webSteps: 'Settings → API keys → Delete → Create new',
    auditUrl: 'https://console.anthropic.com/settings/usage',
    auditInstructions: 'Anthropic Console → Usage. Check for unexpected API calls or token consumption outside your normal patterns.',
  },
};

// ─── Rule ID → provider mapping ──────────────────────────────────────────────

const RULE_TO_PROVIDER = {
  'aws-access-key-id': 'aws',
  'aws-secret-access-key': 'aws',
  'github-pat': 'github',
  'github-oauth': 'github',
  'stripe-live-secret': 'stripe',
  'stripe-live-restricted': 'stripe',
  'stripe-test-secret': 'stripe',
  'slack-bot-token': 'slack',
  'slack-user-token': 'slack',
  'slack-app-token': 'slack',
  'slack-webhook': 'slack',
  'slack-signing-secret': 'slack',
  'openai-api-key': 'openai',
  'anthropic-api-key': 'anthropic',
  'gcp-api-key': 'gcp',
  'azure-connection-string': 'azure',
  'azure-storage-key': 'azure',
  'heroku-token': 'heroku',
  'gitlab-pat': 'github', // closest analog for rotation guidance
};

// ─── Compliance reference data ────────────────────────────────────────────────

const COMPLIANCE_REFS = {
  owasp: ['A02:2021 – Cryptographic Failures', 'A07:2021 – Identification and Authentication Failures'],
  nist: ['NIST SP 800-53 IA-5 (Authenticator Management)', 'NIST SP 800-53 IR-6 (Incident Reporting)'],
  cis: ['CIS Control 3.9 – Encrypt Data on Removable Media', 'CIS Control 5.2 – Use Unique Passwords'],
  soc2: ['CC6.1 – Logical and Physical Access Controls', 'CC7.3 – Security Incident Procedures'],
};

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Derive provider name from a rule ID.
 * @param {string} ruleId
 * @returns {string|null}
 */
function providerFromRuleId(ruleId) {
  return RULE_TO_PROVIDER[ruleId] || null;
}

/**
 * Get today's date as YYYYMMDD.
 * @returns {string}
 */
function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// ─── Step 1: ROTATE ──────────────────────────────────────────────────────────

/**
 * Check whether the provider's CLI tool is installed on this machine.
 *
 * @param {string} provider - provider key (e.g. 'aws', 'github')
 * @returns {{ cli: string, version: string }|null}
 */
function detectProviderCLI(provider) {
  const info = ROTATION_INFO[provider];
  if (!info || !info.cli) return null;
  try {
    execFileSync('which', [info.cli], { stdio: 'ignore' });
    const version = execFileSync(info.cli, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
    return { cli: info.cli, version };
  } catch {
    return null;
  }
}

/**
 * Generate provider-specific rotation instructions for a finding.
 *
 * @param {string} ruleId
 * @returns {{
 *   provider: string,
 *   webUrl: string,
 *   webSteps: string,
 *   commands: string[]|null,
 *   cliDetected: { cli: string, version: string }|null
 * }}
 */
function generateRotationSteps(ruleId) {
  const provider = providerFromRuleId(ruleId) || 'unknown';
  const info = ROTATION_INFO[provider];

  if (!info) {
    return {
      provider,
      webUrl: null,
      webSteps: 'Consult your provider documentation to rotate this credential.',
      commands: null,
      cliDetected: null,
    };
  }

  const cliDetected = detectProviderCLI(provider);

  return {
    provider,
    webUrl: info.webUrl,
    webSteps: info.webSteps,
    commands: info.commands || null,
    cliDetected,
  };
}

// ─── Step 2: AUDIT ───────────────────────────────────────────────────────────

/**
 * Generate provider-specific access log review instructions.
 *
 * @param {string} ruleId
 * @param {{ firstCommit?: string, detected?: string }} [exposureWindow]
 * @returns {{
 *   provider: string,
 *   dashboardUrl: string,
 *   instructions: string,
 *   filters: { dateFrom: string|null, dateTo: string|null }
 * }}
 */
function generateAuditGuidance(ruleId, exposureWindow = {}) {
  const provider = providerFromRuleId(ruleId) || 'unknown';
  const info = ROTATION_INFO[provider];

  const dateFrom = exposureWindow.firstCommit || null;
  const dateTo = exposureWindow.detected || new Date().toISOString();

  if (!info) {
    return {
      provider,
      dashboardUrl: null,
      instructions: 'Review your provider access logs for the exposure window. Look for unexpected API calls, data access, or authentication attempts.',
      filters: { dateFrom, dateTo },
    };
  }

  return {
    provider,
    dashboardUrl: info.auditUrl,
    instructions: info.auditInstructions,
    filters: { dateFrom, dateTo },
  };
}

// ─── Step 4: SCRUB HISTORY ───────────────────────────────────────────────────

/**
 * Generate a git-filter-repo shell script that replaces the exact secret value
 * with REDACTED_BY_GATE in the full git history.
 *
 * The script is saved to <repoDir>/.gate/purge-<date>.sh but is NEVER executed.
 *
 * @param {object} finding - scanner finding (must have .match)
 * @param {string} repoDir - repository root directory
 * @returns {string} the script contents
 */
function generatePurgeScript(finding, repoDir) {
  const secretValue = finding.match;
  const date = new Date().toISOString().slice(0, 10);
  const scriptPath = path.join(repoDir, '.gate', `purge-${date}.sh`);
  const replacementsPath = path.join(repoDir, '.gate', `replacements-${date}.txt`);

  // Build the replacements file content for git-filter-repo --replace-text
  const replacementsContent = `literal:${secretValue}==>literal:REDACTED_BY_GATE\n`;

  const script = `#!/usr/bin/env bash
# ============================================================
# GATE — Git History Purge Script
# Generated: ${new Date().toISOString()}
# Secret type: ${finding.ruleId || 'unknown'}
# File: ${finding.file || 'unknown'}
# Line: ${finding.lineNumber || 'unknown'}
#
# WARNING: This script rewrites git history.
# Every collaborator must re-clone or force-pull after running.
# Run this on a CLEAN working tree with no staged/unstaged changes.
# WARNING: This script contains secret values for replacement purposes. Delete after use.
# Replacements file contains sensitive values — delete after use
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPLACEMENTS_FILE="\${SCRIPT_DIR}/replacements-${date}.txt"

# ─── Pre-flight checks ───────────────────────────────────────
if ! command -v git-filter-repo &>/dev/null; then
  echo "ERROR: git-filter-repo is not installed."
  echo "Install it with: pip install git-filter-repo"
  exit 1
fi

if [ ! -f "\${REPLACEMENTS_FILE}" ]; then
  echo "ERROR: Replacements file not found: \${REPLACEMENTS_FILE}"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: Working tree is not clean."
  echo "Stash or commit your changes before running this script."
  exit 1
fi

echo "Starting history purge..."

# ─── Replace secret with REDACTED_BY_GATE ────────────────────
git filter-repo --replace-text "\${REPLACEMENTS_FILE}"

# ─── Post-purge cleanup ───────────────────────────────────────
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "History purge complete."
echo ""
echo "NEXT STEPS:"
echo "  1. Verify the secret is gone: git log --all -p -S REDACTED_BY_GATE"
echo "  2. Notify all collaborators to re-clone the repository."
echo "  3. Force-push to remote (UNCOMMENT the lines below ONLY when ready):"
echo "  4. Delete the replacements file: rm \${REPLACEMENTS_FILE}"
echo ""

# ─── Force-push (COMMENTED OUT — requires deliberate action) ─
# WARNING: This will overwrite remote history. All collaborators must re-clone.
# git push --force --all
# git push --force --tags

# --- Alternative: BFG Repo-Cleaner ---
# Install: brew install bfg
# bfg --replace-text replacements.txt
`;

  // Write the script and replacements file to disk (creating .gate/ directory if needed)
  try {
    const gateDir = path.join(repoDir, '.gate');
    fs.mkdirSync(gateDir, { recursive: true, mode: 0o700 });
    // Write replacements file with owner-only read/write permissions
    fs.writeFileSync(replacementsPath, replacementsContent, { mode: 0o600 });
    // Write purge script with owner-only executable permissions
    fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  } catch {
    // Non-fatal — caller may not have a real repoDir in tests
  }

  return script;
}

// ─── Step 5: DOCUMENT ────────────────────────────────────────────────────────

/**
 * Determine the next available incident ID for today.
 *
 * @param {string} incidentsDir
 * @returns {string} e.g. "gate-inc-20260321-001"
 */
function nextIncidentId(incidentsDir) {
  const stamp = dateStamp();
  const prefix = `gate-inc-${stamp}-`;

  let maxN = 0;
  if (fs.existsSync(incidentsDir)) {
    const files = fs.readdirSync(incidentsDir);
    for (const f of files) {
      if (f.startsWith(prefix)) {
        const n = parseInt(f.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
  }

  const seq = String(maxN + 1).padStart(3, '0');
  return `${prefix}${seq}`;
}

/**
 * Create a formal JSON incident record at ~/.gate/incidents/<id>.json.
 *
 * @param {object} finding - scanner finding
 * @param {{ firstCommit?: string, detected?: string, durationDays?: number }} exposureWindow
 * @param {object} [options]
 * @param {string} [options.incidentsDir] - override default ~/.gate/incidents
 * @returns {object} the incident record
 */
function createIncidentRecord(finding, exposureWindow = {}, options = {}) {
  const incidentsDir = options.incidentsDir || path.join(os.homedir(), '.gate', 'incidents');
  fs.mkdirSync(incidentsDir, { recursive: true, mode: 0o700 });

  const id = nextIncidentId(incidentsDir);
  const now = new Date().toISOString();

  const record = {
    id,
    detectedAt: now,
    secretType: finding.ruleName || finding.ruleId,
    ruleId: finding.ruleId,
    file: finding.file,
    line: finding.lineNumber,
    exposure: 'pushed',
    exposureWindow: {
      firstCommit: exposureWindow.firstCommit || null,
      detected: exposureWindow.detected || now,
      durationDays: exposureWindow.durationDays || null,
    },
    actions: {
      rotated: false,
      accessLogsReviewed: false,
      codeFixed: false,
      historyPurged: 'pending',
    },
    compliance: {
      owasp: COMPLIANCE_REFS.owasp,
      nist: COMPLIANCE_REFS.nist,
      cis: COMPLIANCE_REFS.cis,
      soc2: COMPLIANCE_REFS.soc2,
    },
  };

  const filePath = path.join(incidentsDir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });

  return record;
}

/**
 * Read an incident record and generate a formal Markdown incident report.
 *
 * @param {string} incidentId - e.g. "gate-inc-20260321-001"
 * @param {object} [options]
 * @param {string} [options.incidentsDir] - override default ~/.gate/incidents
 * @returns {string} Markdown report
 */
function generateIncidentReport(incidentId, options = {}) {
  const incidentsDir = options.incidentsDir || path.join(os.homedir(), '.gate', 'incidents');
  const filePath = path.join(incidentsDir, `${incidentId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Incident record not found: ${filePath}`);
  }

  const rec = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const checkmark = (v) => (v === true ? 'Yes' : v === false ? 'No' : String(v));

  const report = `# Security Incident Report

**Incident ID:** ${rec.id}
**Generated:** ${new Date().toISOString()}
**Severity:** High

---

## Summary

A ${rec.secretType} was found exposed in the repository at \`${rec.file}\` (line ${rec.line}). The credential had been pushed to a remote repository and may have been accessible to unauthorised parties.

---

## Timeline

| Event | Timestamp |
|-------|-----------|
| First known commit with secret | ${rec.exposureWindow.firstCommit || 'Unknown'} |
| Incident detected | ${rec.detectedAt} |
| Exposure duration | ${rec.exposureWindow.durationDays != null ? rec.exposureWindow.durationDays + ' days' : 'Unknown'} |

---

## Affected Credential

| Field | Value |
|-------|-------|
| Secret type | ${rec.secretType} |
| Rule ID | ${rec.ruleId} |
| File | \`${rec.file}\` |
| Line | ${rec.line} |
| Exposure level | ${rec.exposure} |

---

## Actions Taken

| Action | Completed |
|--------|-----------|
| Credential rotated | ${checkmark(rec.actions.rotated)} |
| Access logs reviewed | ${checkmark(rec.actions.accessLogsReviewed)} |
| Code fixed (secret removed) | ${checkmark(rec.actions.codeFixed)} |
| Git history purged | ${checkmark(rec.actions.historyPurged)} |

---

## Compliance References

### OWASP Top 10
${rec.compliance.owasp.map(r => `- ${r}`).join('\n')}

### NIST
${rec.compliance.nist.map(r => `- ${r}`).join('\n')}

### CIS Controls
${rec.compliance.cis.map(r => `- ${r}`).join('\n')}

### SOC 2
${rec.compliance.soc2.map(r => `- ${r}`).join('\n')}

---

## Recommendations

1. **Complete any outstanding actions** listed in the Actions Taken table above.
2. **Implement secret scanning** as a pre-commit hook to prevent future exposure.
3. **Rotate all credentials** that may have been visible in the exposure window.
4. **Review access logs** for the full exposure period (${rec.exposureWindow.firstCommit || 'unknown start'} → ${rec.detectedAt}).
5. **Notify affected parties** if sensitive customer data was accessible via the exposed credential.
6. **Document lessons learned** and update your security policies to prevent recurrence.

---

*Report generated by Gate — Zero-config secret scanner*
*Incident ID: ${rec.id}*
`;

  return report;
}

// ─── Step 3: CLEAN CODE (wrapper) ────────────────────────────────────────────

/**
 * Placeholder for Step 3 — callers should use fixer.fixFinding directly.
 * Exposed here for consistency with the workflow API.
 */
function cleanCode(finding, filePath, options = {}) {
  const fixer = require('./fixer');
  return fixer.fixFinding(finding, filePath, options);
}

// ─── Interactive workflow ─────────────────────────────────────────────────────

/**
 * Walk through all 5 incident response steps interactively.
 *
 * This function is designed to be called from the CLI and uses readline
 * for interactive prompts. In non-interactive environments it prints
 * guidance and exits gracefully.
 *
 * @param {object} finding - scanner finding
 * @param {object} [options]
 * @param {string} [options.repoDir] - repository root (defaults to cwd)
 */
async function startIncidentResponse(finding, options = {}) {
  const repoDir = options.repoDir || process.cwd();
  const { GREEN, RED, BOLD, RESET, YELLOW } = require('./output');

  console.log(`\n${BOLD}${RED}INCIDENT RESPONSE WORKFLOW${RESET}`);
  console.log(`${RED}Secret pushed to remote — full incident response required${RESET}\n`);
  console.log(`Secret type : ${finding.ruleName || finding.ruleId}`);
  console.log(`File        : ${finding.file}`);
  console.log(`Line        : ${finding.lineNumber}\n`);

  // Step 1: ROTATE
  console.log(`${BOLD}Step 1/5 — ROTATE${RESET}`);
  const rotationSteps = generateRotationSteps(finding.ruleId);
  if (rotationSteps.cliDetected) {
    console.log(`  ${GREEN}✓${RESET} ${rotationSteps.cliDetected.cli} CLI detected (${rotationSteps.cliDetected.version})`);
    if (rotationSteps.commands) {
      console.log('  Run these commands:');
      for (const cmd of rotationSteps.commands) {
        console.log(`    ${BOLD}${cmd}${RESET}`);
      }
    }
  } else {
    console.log(`  No CLI detected — use the web console:`);
    console.log(`  URL  : ${rotationSteps.webUrl}`);
    console.log(`  Steps: ${rotationSteps.webSteps}`);
  }

  // Step 2: AUDIT
  console.log(`\n${BOLD}Step 2/5 — AUDIT ACCESS LOGS${RESET}`);
  const auditGuidance = generateAuditGuidance(finding.ruleId);
  console.log(`  Dashboard : ${auditGuidance.dashboardUrl || 'See provider docs'}`);
  console.log(`  What to do: ${auditGuidance.instructions}`);

  // Step 3: CLEAN CODE
  console.log(`\n${BOLD}Step 3/5 — CLEAN CODE${RESET}`);
  console.log('  Use "gate fix" to extract the secret from source code.');
  console.log(`  Command: gate fix --file ${finding.file}`);

  // Step 4: SCRUB HISTORY
  console.log(`\n${BOLD}Step 4/5 — SCRUB GIT HISTORY${RESET}`);
  const date = new Date().toISOString().slice(0, 10);
  const scriptPath = path.join(repoDir, '.gate', `purge-${date}.sh`);
  generatePurgeScript(finding, repoDir);
  console.log(`  ${YELLOW}Purge script saved to: ${scriptPath}${RESET}`);
  console.log('  Review the script, then run it manually when ready.');
  console.log(`  ${RED}WARNING: This rewrites git history. All collaborators must re-clone.${RESET}`);

  // Step 5: DOCUMENT
  console.log(`\n${BOLD}Step 5/5 — DOCUMENT${RESET}`);
  const record = createIncidentRecord(finding, {});
  console.log(`  Incident record: ~/.gate/incidents/${record.id}.json`);
  console.log(`  Generate report: gate incident report ${record.id}`);

  console.log(`\n${GREEN}Incident response workflow complete.${RESET}`);
  console.log(`Incident ID: ${BOLD}${record.id}${RESET}\n`);

  return record;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  startIncidentResponse,
  detectProviderCLI,
  generateRotationSteps,
  generateAuditGuidance,
  generatePurgeScript,
  createIncidentRecord,
  generateIncidentReport,
  // Internals exposed for testing
  _providerFromRuleId: providerFromRuleId,
  _ROTATION_INFO: ROTATION_INFO,
  _RULE_TO_PROVIDER: RULE_TO_PROVIDER,
};
