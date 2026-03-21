/**
 * Multi-strategy remediation engine.
 * 6 strategies covering the full incident response lifecycle.
 * Execution order prevents double-actioning.
 */

import { getRemediation } from './remediation';
import { generateComplianceReport } from './compliance';

export type StrategyId = 'triage' | 'rotate' | 'vault' | 'env_extract' | 'git_purge' | 'compliance';

export type DangerLevel = 'safe' | 'moderate' | 'destructive';

export interface StrategyDef {
  id: StrategyId;
  name: string;
  icon: string;
  danger: DangerLevel;
  description: string;
  order: number;
}

export interface TriageResult {
  riskMatrix: { critical: number; high: number; medium: number; low: number; autoDismissed: number };
  actions: Array<{ idx: number; action: string; reason?: string }>;
}

export interface RotateResult {
  issuesCreated: number;
  actions: Array<{ idx: number; action: string; issueUrl?: string; reason?: string }>;
}

export interface VaultResult {
  script: string;
  migratedCount: number;
  actions: Array<{ idx: number; action: string; pattern?: string }>;
}

export interface EnvExtractResult {
  envTemplate: string;
  codeChanges: Array<{ file: string; line: number; suggestion: string }>;
}

export interface GitPurgeResult {
  script: string;
  affectedFiles: string[];
}

export interface ComplianceResult {
  report: ReturnType<typeof generateComplianceReport>;
}

export type StrategyResult =
  | { strategy: 'triage'; data: TriageResult }
  | { strategy: 'rotate'; data: RotateResult }
  | { strategy: 'vault'; data: VaultResult }
  | { strategy: 'env_extract'; data: EnvExtractResult }
  | { strategy: 'git_purge'; data: GitPurgeResult }
  | { strategy: 'compliance'; data: ComplianceResult };

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'triage',
    name: 'Triage & Classify',
    icon: '\u25b8',       // ▸
    danger: 'safe',
    description: 'Auto-dismiss low-risk findings, build risk matrix, flag critical items for attention',
    order: 1,
  },
  {
    id: 'rotate',
    name: 'Rotate & Revoke',
    icon: '\u27f3',       // ⟳
    danger: 'moderate',
    description: 'Create GitHub issues with provider-specific rotation checklists and compliance references',
    order: 2,
  },
  {
    id: 'vault',
    name: 'Vault Migrate',
    icon: '\u229e',       // ⊞
    danger: 'moderate',
    description: 'Generate gate vault encrypt commands and produce a downloadable migration script',
    order: 3,
  },
  {
    id: 'env_extract',
    name: 'Environment Extract',
    icon: '$',
    danger: 'safe',
    description: 'Generate .env.example template with variable names derived from finding context',
    order: 4,
  },
  {
    id: 'git_purge',
    name: 'Git History Purge',
    icon: '\u2715',       // ✕
    danger: 'destructive',
    description: 'Generate git-filter-repo / BFG commands as a downloadable script (NOT executed)',
    order: 5,
  },
  {
    id: 'compliance',
    name: 'Compliance Report',
    icon: '\u25c8',       // ◈
    danger: 'safe',
    description: 'Map findings to OWASP/NIST/CIS/SOC2 frameworks and generate a structured report',
    order: 6,
  },
];

/** Canonical execution order */
export const STRATEGY_ORDER: StrategyId[] = ['triage', 'rotate', 'vault', 'env_extract', 'git_purge', 'compliance'];

export function getStrategy(id: StrategyId): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

// ── Strategy Executors ───────────────────────────────────────────

/** Track which finding indices have been actioned to prevent double-actioning */
type ActionedSet = Set<number>;

/** Check if a finding index is in the user's selection (undefined = all selected) */
function isSelected(idx: number, selectedIndices?: Set<number>): boolean {
  return !selectedIndices || selectedIndices.has(idx);
}

/**
 * Triage & Classify — auto-dismiss low, flag medium, mark critical/high urgent
 */
export function executeTriage(
  findings: any[],
  alreadyActioned: Set<number>,
  selectedIndices?: Set<number>,
): TriageResult {
  const riskMatrix = { critical: 0, high: 0, medium: 0, low: 0, autoDismissed: 0 };
  const actions: TriageResult['actions'] = [];

  for (let idx = 0; idx < findings.length; idx++) {
    if (alreadyActioned.has(idx)) continue;
    if (!isSelected(idx, selectedIndices)) continue;
    const severity = (findings[idx].severity || 'medium').toLowerCase();

    if (severity === 'critical') riskMatrix.critical++;
    else if (severity === 'high') riskMatrix.high++;
    else if (severity === 'medium') riskMatrix.medium++;
    else riskMatrix.low++;

    if (severity === 'low') {
      alreadyActioned.add(idx);
      riskMatrix.autoDismissed++;
      actions.push({ idx, action: 'dismiss', reason: '[triage] Auto-dismissed: low severity' });
    }
  }

  return { riskMatrix, actions };
}

/**
 * Rotate & Revoke — builds issue payloads for critical/high findings
 * Returns data needed for the backend to create GitHub issues.
 */
export function executeRotate(
  findings: any[],
  alreadyActioned: Set<number>,
  scanId: string,
  branch: string,
  selectedIndices?: Set<number>,
): RotateResult {
  const actions: RotateResult['actions'] = [];
  let issuesCreated = 0;

  for (let idx = 0; idx < findings.length; idx++) {
    if (alreadyActioned.has(idx)) continue;
    if (!isSelected(idx, selectedIndices)) continue;
    const finding = findings[idx];
    const severity = (finding.severity || 'medium').toLowerCase();
    if (severity !== 'critical' && severity !== 'high') continue;

    const ruleId = finding.ruleId || '';
    const rem = getRemediation(ruleId);
    if (rem.action !== 'rotate') continue;

    alreadyActioned.add(idx);
    issuesCreated++;
    actions.push({
      idx,
      action: 'issue_created',
      reason: `[rotate] ${rem.guide.slice(0, 200)}`,
    });
  }

  return { issuesCreated, actions };
}

/** Build GitHub issue title and body for a rotation finding */
export function buildRotationIssue(
  finding: any,
  scanId: string,
  branch: string,
): { title: string; body: string; labels: string[] } {
  const ruleId = finding.ruleId || '';
  const rem = getRemediation(ruleId);
  const file = finding.file || 'unknown file';
  const line = finding.lineNumber || 'unknown';
  const severity = (finding.severity || 'medium').toUpperCase();
  const ruleName = finding.ruleName || 'Secret detected';

  const title = `[GATE] Rotate: ${ruleName} in ${file}:${line}`.slice(0, 256);
  const body = [
    `## Secret Finding — Rotate & Revoke`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **File** | \`${file}\` |`,
    `| **Line** | ${line} |`,
    `| **Rule** | ${ruleName} |`,
    `| **Severity** | ${severity} |`,
    `| **Branch** | ${branch} |`,
    ``,
    `## Provider-Specific Rotation Steps`,
    ``,
    rem.guide,
    ``,
    rem.link ? `**Reference:** ${rem.link}` : '',
    ``,
    `## Incident Response Checklist`,
    ``,
    `- [ ] Rotate/revoke the exposed credential at the provider`,
    `- [ ] Audit provider access logs for unauthorized usage`,
    `- [ ] Remove secret from source code`,
    `- [ ] Scrub from git history (\`git-filter-repo\` or BFG Repo-Cleaner)`,
    `- [ ] Store replacement in a secrets manager`,
    ``,
    `## Compliance References`,
    ``,
    `- OWASP A07:2021 — Identification and Authentication Failures`,
    `- NIST SP 800-63B — Credential Lifecycle Management`,
    `- CIS Controls v8 §16.4 — Encrypt or Hash All Authentication Credentials`,
    ``,
    `## Incident Timeline`,
    ``,
    `- **Detected:** ${new Date().toISOString()}`,
    `- **Scan ID:** \`${scanId.slice(0, 8)}\``,
    ``,
    `---`,
    `*Created by [Penumbra Gate](https://github.com/penumbraforge/gate) — Rotate & Revoke strategy*`,
  ].filter(Boolean).join('\n');

  return { title, body, labels: ['security', 'gate-finding', 'secret-rotation'] };
}

/**
 * Vault Migrate — generate gate vault encrypt commands + add to allowlist
 */
export function executeVault(
  findings: any[],
  alreadyActioned: Set<number>,
  selectedIndices?: Set<number>,
): VaultResult {
  const lines: string[] = [
    '#!/bin/bash',
    '# Gate Vault Migration Script',
    `# Generated: ${new Date().toISOString()}`,
    '# Run this script to encrypt all detected secrets with gate vault',
    '',
    'set -euo pipefail',
    '',
  ];
  const actions: VaultResult['actions'] = [];
  let migratedCount = 0;

  for (let idx = 0; idx < findings.length; idx++) {
    if (alreadyActioned.has(idx)) continue;
    if (!isSelected(idx, selectedIndices)) continue;
    const finding = findings[idx];
    const ruleId = finding.ruleId || '';
    const rem = getRemediation(ruleId);
    if (rem.action !== 'encrypt' && rem.action !== 'use_vault') continue;

    const file = finding.file || 'unknown';
    const line = finding.lineNumber || 0;
    const pattern = `${file}:${ruleId || '*'}`;

    lines.push(`# ${finding.ruleName || ruleId} in ${file}:${line}`);
    lines.push(`gate vault encrypt --file "${file}" --line ${line}`);
    lines.push('');

    alreadyActioned.add(idx);
    migratedCount++;
    actions.push({ idx, action: 'allowlist', pattern });
  }

  if (migratedCount === 0) {
    lines.push('echo "No vault-eligible findings found."');
  } else {
    lines.push(`echo "Migrated ${migratedCount} secrets to vault."`);
  }

  return { script: lines.join('\n'), migratedCount, actions };
}

/**
 * Environment Extract — generate .env.example + code change suggestions
 */
export function executeEnvExtract(
  findings: any[],
  alreadyActioned: Set<number>,
  selectedIndices?: Set<number>,
): EnvExtractResult {
  const envVars: Map<string, string> = new Map();
  const codeChanges: EnvExtractResult['codeChanges'] = [];

  for (let idx = 0; idx < findings.length; idx++) {
    if (alreadyActioned.has(idx)) continue;
    if (!isSelected(idx, selectedIndices)) continue;
    const finding = findings[idx];
    const ruleId = finding.ruleId || '';
    const rem = getRemediation(ruleId);
    if (rem.action !== 'move_to_env') continue;

    // Derive variable name from rule ID
    const varName = deriveEnvVarName(ruleId, finding.ruleName || '');
    const file = finding.file || 'unknown';
    const line = finding.lineNumber || 0;

    if (!envVars.has(varName)) {
      envVars.set(varName, `# ${finding.ruleName || ruleId}`);
    }
    codeChanges.push({
      file,
      line,
      suggestion: `Replace hardcoded value with process.env.${varName}`,
    });

    // Don't mark as actioned — env_extract is advisory only
  }

  const templateLines = ['# .env.example', `# Generated by Gate — ${new Date().toISOString()}`, ''];
  for (const [name, comment] of envVars) {
    templateLines.push(comment);
    templateLines.push(`${name}=`);
    templateLines.push('');
  }

  if (envVars.size === 0) {
    templateLines.push('# No environment-eligible findings detected.');
  }

  return { envTemplate: templateLines.join('\n'), codeChanges };
}

function deriveEnvVarName(ruleId: string, ruleName: string): string {
  // Map known rule IDs to conventional env var names
  const map: Record<string, string> = {
    'password-assignment': 'DB_PASSWORD',
    'api-key-assignment': 'API_KEY',
    'secret-assignment': 'APP_SECRET',
    'token-assignment': 'AUTH_TOKEN',
    'auth-header': 'BEARER_TOKEN',
    'mongodb-uri': 'MONGODB_URI',
    'postgres-uri': 'DATABASE_URL',
    'mysql-uri': 'MYSQL_URL',
    'stripe-live-public': 'STRIPE_PUBLISHABLE_KEY',
    'stripe-test-secret': 'STRIPE_TEST_SECRET_KEY',
    'oauth-bearer': 'OAUTH_BEARER_TOKEN',
    'sentry-dsn': 'SENTRY_DSN',
    'env-var-secret': 'SECRET_VALUE',
  };
  if (map[ruleId]) return map[ruleId];
  // Fallback: convert rule name to SCREAMING_SNAKE_CASE
  return ruleName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'SECRET_VALUE';
}

/**
 * Git History Purge — generate git-filter-repo / BFG commands (NOT executed)
 */
export function executeGitPurge(
  findings: any[],
  alreadyActioned: Set<number>,
  selectedIndices?: Set<number>,
): GitPurgeResult {
  const affectedFiles = new Set<string>();

  for (let idx = 0; idx < findings.length; idx++) {
    if (!isSelected(idx, selectedIndices)) continue;
    const finding = findings[idx];
    const severity = (finding.severity || 'medium').toLowerCase();
    if (severity === 'critical' || severity === 'high') {
      if (finding.file) affectedFiles.add(finding.file);
    }
  }

  const files = Array.from(affectedFiles);
  const lines: string[] = [
    '#!/bin/bash',
    '# Gate Git History Purge Script',
    `# Generated: ${new Date().toISOString()}`,
    '# WARNING: This will rewrite git history. All collaborators must re-clone.',
    '# This script is generated for review — NOT auto-executed.',
    '',
    'set -euo pipefail',
    '',
    '# Option 1: git-filter-repo (recommended)',
    '# Install: pip install git-filter-repo',
    '',
  ];

  if (files.length === 0) {
    lines.push('echo "No critical/high files to purge."');
  } else {
    for (const file of files) {
      lines.push(`git filter-repo --invert-paths --path "${file}"`);
    }
    lines.push('');
    lines.push('# Option 2: BFG Repo-Cleaner (alternative)');
    lines.push('# Install: brew install bfg');
    lines.push('');
    for (const file of files) {
      const basename = file.split('/').pop() || file;
      lines.push(`# bfg --delete-files "${basename}"`);
    }
    lines.push('');
    lines.push('# Post-purge cleanup');
    lines.push('git reflog expire --expire=now --all');
    lines.push('git gc --prune=now --aggressive');
    lines.push('');
    lines.push('# Force-push (requires confirmation from team)');
    lines.push('# git push --force --all');
    lines.push('# git push --force --tags');
    lines.push('');
    lines.push(`echo "Purged ${files.length} files from git history."`);
    lines.push('echo "All collaborators must re-clone the repository."');
  }

  return { script: lines.join('\n'), affectedFiles: files };
}

/**
 * Compliance Report — map findings to OWASP/NIST/CIS/SOC2
 */
export function executeCompliance(
  findings: any[],
  selectedIndices?: Set<number>,
): ComplianceResult {
  const filtered = selectedIndices
    ? findings.filter((_, idx) => selectedIndices.has(idx))
    : findings;
  return { report: generateComplianceReport(filtered) };
}
