/**
 * Report generation module for Gate
 * Generates compliance reports, SARIF output, and machine-readable JSON.
 */

'use strict';

const { getRemediation } = require('./remediation');

// ── Compliance framework mappings ─────────────────────────────────────────────

const COMPLIANCE_MAP = {
  'aws-access-key-id':    { owasp: ['A02:2021'], nist: ['SC-12', 'IA-5'], cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'aws-secret-access-key':{ owasp: ['A02:2021'], nist: ['SC-12', 'IA-5'], cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'github-pat':           { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'github-oauth':         { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'github-app-token':     { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'stripe-live-secret':   { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1', 'CC9.2'] },
  'stripe-live-public':   { owasp: ['A05:2021'], nist: [],                 cis: [],           soc2: [] },
  'stripe-live-restricted':{ owasp: ['A02:2021'], nist: ['SC-12'],         cis: [],           soc2: ['CC6.1'] },
  'stripe-test-secret':   { owasp: ['A05:2021'], nist: [],                 cis: [],           soc2: [] },
  'slack-bot-token':      { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'slack-user-token':     { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'slack-webhook':        { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: [] },
  'private-key-rsa':      { owasp: ['A02:2021'], nist: ['SC-12', 'SC-17'], cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'private-key-openssh':  { owasp: ['A02:2021'], nist: ['SC-12', 'SC-17'], cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'private-key-dsa':      { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'private-key-ec':       { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'private-key-generic':  { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'pgp-private-key':      { owasp: ['A02:2021'], nist: ['SC-12', 'SC-17'], cis: [],           soc2: ['CC6.1'] },
  'password-assignment':  { owasp: ['A07:2021'], nist: ['IA-5'],           cis: ['CIS 5.2'],  soc2: ['CC6.1'] },
  'api-key-assignment':   { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'secret-assignment':    { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'token-assignment':     { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'auth-header':          { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'mongodb-uri':          { owasp: ['A02:2021'], nist: ['SC-12'],          cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'postgres-uri':         { owasp: ['A02:2021'], nist: ['SC-12'],          cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'mysql-uri':            { owasp: ['A02:2021'], nist: ['SC-12'],          cis: ['CIS 14.4'], soc2: ['CC6.1'] },
  'openai-api-key':       { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'anthropic-api-key':    { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'gcp-api-key':          { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'azure-connection-string':{ owasp: ['A02:2021'], nist: ['SC-12'],        cis: [],           soc2: ['CC6.1'] },
  'sendgrid-api-key':     { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'twilio-api-key':       { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'firebase-key':         { owasp: ['A02:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'npm-token':            { owasp: ['A08:2021'], nist: ['SC-12'],          cis: [],           soc2: ['CC6.1'] },
  'jwt-token':            { owasp: ['A07:2021'], nist: ['IA-5'],           cis: [],           soc2: ['CC6.2'] },
  'high-entropy-string':  { owasp: ['A02:2021'], nist: [],                 cis: [],           soc2: [] },
};

const DEFAULT_COMPLIANCE = { owasp: [], nist: [], cis: [], soc2: [] };

function getCompliance(ruleId) {
  return COMPLIANCE_MAP[ruleId] || DEFAULT_COMPLIANCE;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Flatten audit entries into individual findings with metadata.
 */
function flattenAuditFindings(auditData) {
  const entries = (auditData && auditData.entries) || [];
  const findings = [];

  for (const entry of entries) {
    for (const f of (entry.findings || [])) {
      findings.push({
        file: (entry.filesScanned || [])[0] || 'unknown',
        lineNumber: f.lineNumber || null,
        ruleId: f.ruleId || '',
        ruleName: f.ruleName || f.ruleId || '',
        severity: f.severity || 'unknown',
        status: f.status || entry.action || 'open',
        timestamp: entry.timestamp,
        commitHash: entry.commitHash,
        compliance: f.compliance || getCompliance(f.ruleId),
      });
    }
  }

  return findings;
}

/**
 * Build severity count summary from a findings array.
 */
function countSeverities(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  return counts;
}

/**
 * Collect all unique compliance controls triggered across findings.
 */
function collectComplianceControls(findings) {
  const controls = { owasp: new Set(), nist: new Set(), cis: new Set(), soc2: new Set() };

  for (const f of findings) {
    const c = f.compliance || getCompliance(f.ruleId);
    for (const framework of ['owasp', 'nist', 'cis', 'soc2']) {
      for (const control of (c[framework] || [])) {
        controls[framework].add(control);
      }
    }
  }

  return {
    owasp: [...controls.owasp].sort(),
    nist:  [...controls.nist].sort(),
    cis:   [...controls.cis].sort(),
    soc2:  [...controls.soc2].sort(),
  };
}

// ── generateComplianceReport ──────────────────────────────────────────────────

/**
 * Generate a Markdown compliance report from audit log data.
 *
 * @param {object} auditData - Object with `entries` array from audit log
 * @param {object} [options]
 * @returns {string} Markdown report
 */
function generateComplianceReport(auditData, options = {}) {
  const findings = flattenAuditFindings(auditData);
  const total = findings.length;
  const severities = countSeverities(findings);
  const fixedCount  = findings.filter(f => f.status === 'fixed').length;
  const ignoredCount = findings.filter(f => f.status === 'ignored').length;
  const openCount = total - fixedCount - ignoredCount;
  const controls = collectComplianceControls(findings);

  const lines = [];

  // Title & date
  lines.push('# Gate Security Compliance Report');
  lines.push('');
  lines.push(`**Generated:** ${today()}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  if (total === 0) {
    lines.push('No findings recorded in the selected audit period.');
  } else {
    lines.push(`**Total findings:** ${total}`);
    lines.push('');
    lines.push('**By severity:**');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| Critical | ${severities.critical} |`);
    lines.push(`| High     | ${severities.high} |`);
    lines.push(`| Medium   | ${severities.medium} |`);
    lines.push(`| Low      | ${severities.low} |`);
    lines.push('');
    lines.push('**Resolution status:**');
    lines.push('');
    lines.push(`- Open: ${openCount}`);
    lines.push(`- Fixed: ${fixedCount}`);
    lines.push(`- Ignored: ${ignoredCount}`);
  }
  lines.push('');

  // Findings table
  lines.push('## Findings');
  lines.push('');
  if (findings.length === 0) {
    lines.push('_No findings._');
  } else {
    lines.push('| File | Line | Rule | Severity | Status |');
    lines.push('|------|------|------|----------|--------|');
    for (const f of findings) {
      const file = f.file || 'unknown';
      const line = f.lineNumber != null ? f.lineNumber : '-';
      const rule = f.ruleName || f.ruleId;
      const sev  = f.severity;
      const status = f.status || 'open';
      lines.push(`| \`${file}\` | ${line} | ${rule} | ${sev} | ${status} |`);
    }
  }
  lines.push('');

  // Compliance framework coverage
  lines.push('## Compliance Framework Coverage');
  lines.push('');
  lines.push('Controls triggered across all findings:');
  lines.push('');

  lines.push('**OWASP Top 10:**');
  lines.push(controls.owasp.length > 0 ? controls.owasp.join(', ') : '_None_');
  lines.push('');

  lines.push('**NIST SP 800-53:**');
  lines.push(controls.nist.length > 0 ? controls.nist.join(', ') : '_None_');
  lines.push('');

  lines.push('**CIS Controls:**');
  lines.push(controls.cis.length > 0 ? controls.cis.join(', ') : '_None_');
  lines.push('');

  lines.push('**SOC 2 Criteria:**');
  lines.push(controls.soc2.length > 0 ? controls.soc2.join(', ') : '_None_');
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  if (total === 0) {
    lines.push('1. Continue running Gate on every commit to maintain a clean baseline.');
    lines.push('2. Ensure all team members have Gate installed as a pre-commit hook.');
  } else {
    lines.push('1. Rotate all credentials flagged as **live** (verified) immediately.');
    lines.push('2. Purge secrets from git history using `git filter-repo` for any committed secrets.');
    lines.push('3. Move all secrets to a secrets manager (AWS Secrets Manager, HashiCorp Vault, or Doppler).');
    if (openCount > 0) {
      lines.push(`4. Resolve the ${openCount} open finding${openCount > 1 ? 's' : ''} before the next release.`);
    }
    lines.push('5. Enable Gate as a CI gate to prevent future secret commits.');
  }
  lines.push('');

  return lines.join('\n');
}

// ── generateHTMLReport ────────────────────────────────────────────────────────

/**
 * Escape HTML special characters.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a styled HTML compliance report.
 *
 * @param {object} auditData
 * @param {object} [options]
 * @returns {string} HTML document
 */
function generateHTMLReport(auditData, options = {}) {
  const findings = flattenAuditFindings(auditData);
  const total = findings.length;
  const severities = countSeverities(findings);
  const fixedCount   = findings.filter(f => f.status === 'fixed').length;
  const ignoredCount = findings.filter(f => f.status === 'ignored').length;
  const openCount = total - fixedCount - ignoredCount;
  const controls = collectComplianceControls(findings);

  const severityColor = { critical: '#d32f2f', high: '#f57c00', medium: '#fbc02d', low: '#388e3c' };
  const statusColor   = { fixed: '#388e3c', open: '#d32f2f', ignored: '#9e9e9e' };

  const style = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #212121; }
    .container { max-width: 960px; margin: 40px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); padding: 40px; }
    h1 { font-size: 24px; margin-bottom: 4px; color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
    h2 { font-size: 18px; color: #1a1a2e; margin-top: 32px; margin-bottom: 12px; }
    .meta { color: #757575; font-size: 13px; margin-bottom: 24px; }
    .summary-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
    .stat-card { background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px 24px; text-align: center; min-width: 100px; }
    .stat-card .num { font-size: 28px; font-weight: 700; }
    .stat-card .label { font-size: 12px; color: #757575; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #1a1a2e; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; }
    td { padding: 9px 12px; border-bottom: 1px solid #e0e0e0; }
    tr:hover td { background: #f5f5f5; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; }
    .controls-grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .control-box { flex: 1; min-width: 180px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; }
    .control-box h3 { font-size: 13px; margin: 0 0 8px; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
    .control-tag { display: inline-block; background: #e8eaf6; color: #3949ab; border-radius: 4px; padding: 2px 6px; font-size: 12px; margin: 2px; }
    .recs ol { margin: 0; padding-left: 20px; }
    .recs li { margin-bottom: 6px; }
    .empty { color: #9e9e9e; font-style: italic; }
    @media print { body { background: #fff; } .container { box-shadow: none; padding: 20px; } }
  `;

  const rows = findings.map(f => {
    const sev = f.severity || 'unknown';
    const color = severityColor[sev] || '#9e9e9e';
    const st = f.status || 'open';
    const stColor = statusColor[st] || '#9e9e9e';
    return `
      <tr>
        <td><code>${escapeHtml(f.file)}</code></td>
        <td>${f.lineNumber != null ? f.lineNumber : '-'}</td>
        <td>${escapeHtml(f.ruleName || f.ruleId)}</td>
        <td><span class="badge" style="background:${color}">${escapeHtml(sev)}</span></td>
        <td><span class="badge" style="background:${stColor}">${escapeHtml(st)}</span></td>
      </tr>`;
  }).join('');

  const controlBox = (label, items) => {
    const tags = items.length > 0
      ? items.map(c => `<span class="control-tag">${escapeHtml(c)}</span>`).join('')
      : '<span class="empty">None</span>';
    return `<div class="control-box"><h3>${label}</h3>${tags}</div>`;
  };

  const recItems = total === 0
    ? [
        'Continue running Gate on every commit to maintain a clean baseline.',
        'Ensure all team members have Gate installed as a pre-commit hook.',
      ]
    : [
        'Rotate all credentials flagged as <strong>live</strong> (verified) immediately.',
        'Purge secrets from git history using <code>git filter-repo</code> for any committed secrets.',
        'Move all secrets to a secrets manager (AWS Secrets Manager, HashiCorp Vault, or Doppler).',
        openCount > 0 ? `Resolve the ${openCount} open finding${openCount > 1 ? 's' : ''} before the next release.` : null,
        'Enable Gate as a CI gate to prevent future secret commits.',
      ].filter(Boolean);

  const summarySection = total === 0
    ? '<p class="empty">No findings recorded in the selected audit period.</p>'
    : `
      <div class="summary-grid">
        <div class="stat-card"><div class="num">${total}</div><div class="label">Total Findings</div></div>
        <div class="stat-card"><div class="num" style="color:#d32f2f">${severities.critical}</div><div class="label">Critical</div></div>
        <div class="stat-card"><div class="num" style="color:#f57c00">${severities.high}</div><div class="label">High</div></div>
        <div class="stat-card"><div class="num" style="color:#fbc02d">${severities.medium}</div><div class="label">Medium</div></div>
        <div class="stat-card"><div class="num" style="color:#388e3c">${severities.low}</div><div class="label">Low</div></div>
        <div class="stat-card"><div class="num" style="color:#388e3c">${fixedCount}</div><div class="label">Fixed</div></div>
        <div class="stat-card"><div class="num" style="color:#d32f2f">${openCount}</div><div class="label">Open</div></div>
        <div class="stat-card"><div class="num" style="color:#9e9e9e">${ignoredCount}</div><div class="label">Ignored</div></div>
      </div>`;

  const findingsSection = findings.length === 0
    ? '<p class="empty">No findings.</p>'
    : `
      <table>
        <thead><tr><th>File</th><th>Line</th><th>Rule</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gate Security Compliance Report</title>
  <style>${style}</style>
</head>
<body>
  <div class="container">
    <h1>Gate Security Compliance Report</h1>
    <div class="meta">Generated: ${today()}</div>

    <h2>Executive Summary</h2>
    ${summarySection}

    <h2>Findings</h2>
    ${findingsSection}

    <h2>Compliance Framework Coverage</h2>
    <div class="controls-grid">
      ${controlBox('OWASP Top 10', controls.owasp)}
      ${controlBox('NIST SP 800-53', controls.nist)}
      ${controlBox('CIS Controls', controls.cis)}
      ${controlBox('SOC 2 Criteria', controls.soc2)}
    </div>

    <h2>Recommendations</h2>
    <div class="recs">
      <ol>
        ${recItems.map(r => `<li>${r}</li>`).join('\n        ')}
      </ol>
    </div>
  </div>
</body>
</html>`;

  return html;
}

// ── generateSARIF ─────────────────────────────────────────────────────────────

/**
 * Map Gate severity levels to SARIF level strings.
 */
function severityToSARIFLevel(severity) {
  const map = { critical: 'error', high: 'error', medium: 'warning', low: 'note' };
  return map[severity] || 'warning';
}

/**
 * Build SARIF rule descriptors from scan results.
 * Deduplicates rules across all file findings.
 */
function buildRuleDescriptors(scanResults) {
  const seen = new Map();

  for (const fileResult of (scanResults.filesScanned || [])) {
    for (const finding of (fileResult.findings || [])) {
      if (!seen.has(finding.ruleId)) {
        const remediation = getRemediation(finding.ruleId);
        seen.set(finding.ruleId, {
          id: finding.ruleId,
          name: finding.ruleName || finding.ruleId,
          shortDescription: {
            text: finding.ruleName || finding.ruleId,
          },
          fullDescription: {
            text: `${finding.ruleName || finding.ruleId} — severity: ${finding.severity || 'unknown'}`,
          },
          help: {
            text: remediation.guide || `See Gate documentation for ${finding.ruleId}.`,
            markdown: remediation.link
              ? `${remediation.guide || ''} [Learn more](${remediation.link})`
              : remediation.guide || `See Gate documentation for ${finding.ruleId}.`,
          },
          properties: {
            tags: ['security', finding.severity || 'unknown'],
            severity: finding.severity,
          },
        });
      }
    }
  }

  return [...seen.values()];
}

/**
 * Generate SARIF 2.1.0 output from scan results.
 *
 * @param {object} scanResults - Object with `filesScanned` array
 * @param {object} [options]
 * @returns {object} SARIF 2.1.0 JSON object
 */
function generateSARIF(scanResults, options = {}) {
  let version;
  try {
    version = require('../../package.json').version;
  } catch {
    version = '0.0.0';
  }

  const flattenedFindings = Array.isArray(options.findings)
    ? options.findings
    : (scanResults.filesScanned || []).flatMap(fileResult =>
      (fileResult.findings || []).map(finding => ({
        ...finding,
        file: finding.file || fileResult.file,
      }))
    );

  const results = flattenedFindings.map(finding => {
    const sarifResult = {
      ruleId: finding.ruleId,
      level: severityToSARIFLevel(finding.severity),
      message: { text: finding.ruleName || finding.ruleId },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            region: {
              startLine: finding.lineNumber || 1,
              startColumn: (finding.matchStart || 0) + 1,
            },
          },
        },
      ],
    };

    if (finding.verification) {
      sarifResult.properties = { verification: finding.verification };
    }

    return sarifResult;
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Gate',
            version,
            informationUri: 'https://github.com/penumbraforge/gate',
            rules: buildRuleDescriptors(scanResults),
          },
        },
        results,
      },
    ],
  };
}

// ── generateJSONReport ────────────────────────────────────────────────────────

/**
 * Generate machine-readable JSON report from scan results.
 *
 * @param {object} scanResults - Object with `filesScanned` array
 * @param {object} [options]
 * @returns {object} JSON report object
 */
function generateJSONReport(scanResults, options = {}) {
  let version;
  try {
    version = require('../../package.json').version;
  } catch {
    version = '0.0.0';
  }

  const allFindings = [];
  const errors = Array.isArray(scanResults.errors) ? scanResults.errors : [];
  const skipped = Array.isArray(scanResults.skippedFiles) ? scanResults.skippedFiles : [];
  const uniqueFiles = new Set();

  const flattenedFindings = Array.isArray(options.findings)
    ? options.findings
    : null;

  for (const fileResult of (scanResults.filesScanned || [])) {
    if (fileResult.file) {
      uniqueFiles.add(fileResult.file);
    } else if (Array.isArray(fileResult.filesScanned)) {
      for (const scannedFile of fileResult.filesScanned) {
        uniqueFiles.add(scannedFile);
      }
    }
  }

  const findingsSource = flattenedFindings || (scanResults.filesScanned || []).flatMap((fileResult) =>
    (fileResult.findings || []).map((finding) => ({
      ...finding,
      file: finding.file || fileResult.file || null,
    }))
  );

  for (const finding of findingsSource) {
    const remediation = getRemediation(finding.ruleId);
    const compliance  = finding.compliance || getCompliance(finding.ruleId);
    const findingFile = finding.file || null;

    if (findingFile) {
      uniqueFiles.add(findingFile);
    }

    allFindings.push({
      ruleId:       finding.ruleId,
      ruleName:     finding.ruleName || finding.ruleId,
      severity:     finding.severity || 'unknown',
      file:         findingFile,
      line:         finding.lineNumber || null,
      column:       finding.matchStart != null ? finding.matchStart + 1 : null,
      match:        finding.match || null,
      verification: finding.verification ? finding.verification.status || finding.verification : 'unknown',
      exposure:     finding.exposure || 'unknown',
      remediation: {
        action: remediation.action || 'review',
        guide:  remediation.guide  || '',
        link:   remediation.link   || null,
      },
      compliance,
    });
  }

  // Count severities
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of allFindings) {
    if (severityCounts[f.severity] !== undefined) severityCounts[f.severity]++;
  }

  // Count verification statuses
  const verified = { live: 0, inactive: 0, unknown: 0 };
  for (const f of allFindings) {
    const v = f.verification;
    if (v === 'live')     verified.live++;
    else if (v === 'inactive') verified.inactive++;
    else                  verified.unknown++;
  }

  return {
    version,
    timestamp: new Date().toISOString(),
    findings: allFindings,
    errors,
    skipped,
    summary: {
      filesScanned:  uniqueFiles.size || (scanResults.filesScanned || []).length,
      totalFindings: allFindings.length,
      critical:      severityCounts.critical,
      high:          severityCounts.high,
      medium:        severityCounts.medium,
      low:           severityCounts.low,
      errors:        errors.length,
      skipped:       skipped.length,
      verified,
    },
  };
}

// ── generateIncidentReport ────────────────────────────────────────────────────

/**
 * Generate a Markdown incident report from an incident record.
 *
 * @param {object} incidentRecord
 * @returns {string} Markdown report
 */
function generateIncidentReport(incidentRecord) {
  const rec = incidentRecord || {};
  const lines = [];

  lines.push('# Security Incident Report');
  lines.push('');
  lines.push(`**Incident ID:** ${rec.id || 'N/A'}`);
  lines.push(`**Date Detected:** ${formatDate(rec.dateDetected)}`);
  lines.push(`**Severity:** ${rec.severity || 'Unknown'}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(rec.summary || '_No summary provided._');
  lines.push('');

  // Timeline
  lines.push('## Timeline');
  lines.push('');
  lines.push('| Time | Event |');
  lines.push('|------|-------|');
  const timeline = rec.timeline || [];
  if (timeline.length === 0) {
    lines.push('| — | No timeline entries. |');
  } else {
    for (const entry of timeline) {
      const time  = entry.time ? entry.time.replace('T', ' ').replace('.000Z', ' UTC') : '—';
      const event = entry.event || '—';
      lines.push(`| ${time} | ${event} |`);
    }
  }
  lines.push('');

  // Actions taken
  lines.push('## Actions Taken');
  lines.push('');
  const actions = rec.actionsTaken || [];
  if (actions.length === 0) {
    lines.push('_No actions recorded._');
  } else {
    actions.forEach((action, i) => {
      const check = action.done ? '✓' : '○';
      lines.push(`${i + 1}. ${check} ${action.description || '—'}`);
    });
  }
  lines.push('');

  // Compliance References
  lines.push('## Compliance References');
  lines.push('');
  const refs = rec.complianceRefs || [];
  if (refs.length === 0) {
    lines.push('_None specified._');
  } else {
    for (const ref of refs) {
      lines.push(`- ${ref}`);
    }
  }
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  const recs = rec.recommendations || [];
  if (recs.length === 0) {
    lines.push('_None specified._');
  } else {
    recs.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
  }
  lines.push('');

  return lines.join('\n');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateComplianceReport,
  generateHTMLReport,
  generateSARIF,
  generateJSONReport,
  generateIncidentReport,
};
