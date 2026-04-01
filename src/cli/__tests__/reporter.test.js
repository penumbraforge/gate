/**
 * Tests for report generation module
 */

const {
  generateComplianceReport,
  generateHTMLReport,
  generateSARIF,
  generateJSONReport,
  generateIncidentReport,
} = require('../reporter');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeScanResults(overrides = {}) {
  return {
    filesScanned: [
      {
        file: 'src/config.js',
        findings: [
          {
            ruleId: 'aws-access-key-id',
            ruleName: 'AWS Access Key ID',
            severity: 'critical',
            lineNumber: 42,
            matchStart: 10,
            matchLength: 20,
            match: 'AKIA...ABCD',
            verification: { status: 'live' },
            exposure: 'committed',
            compliance: {
              owasp: ['A02:2021'],
              nist: ['SC-12'],
              cis: ['CIS 14.4'],
              soc2: ['CC6.1'],
            },
          },
          {
            ruleId: 'github-pat',
            ruleName: 'GitHub Personal Access Token',
            severity: 'high',
            lineNumber: 88,
            matchStart: 0,
            matchLength: 40,
            match: 'ghp_...wxyz',
            verification: { status: 'inactive' },
            exposure: 'local',
            compliance: {
              owasp: ['A07:2021'],
              nist: ['IA-5'],
              cis: [],
              soc2: [],
            },
          },
        ],
      },
      {
        file: 'tests/fixtures/sample.env',
        findings: [
          {
            ruleId: 'stripe-live-secret',
            ruleName: 'Stripe Live Secret Key',
            severity: 'critical',
            lineNumber: 3,
            matchStart: 12,
            matchLength: 30,
            match: 'sk_live...xxxx',
            verification: null,
            exposure: 'pushed',
            compliance: {
              owasp: ['A02:2021'],
              nist: ['SC-12'],
              cis: [],
              soc2: ['CC6.1'],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeAuditData(overrides = {}) {
  return {
    entries: [
      {
        timestamp: '2026-03-20T10:00:00.000Z',
        commitHash: 'abc123',
        filesScanned: ['src/config.js'],
        findings: [
          {
            ruleId: 'aws-access-key-id',
            ruleName: 'AWS Access Key ID',
            severity: 'critical',
            lineNumber: 42,
            status: 'fixed',
          },
        ],
        findingCount: 1,
        severityCounts: { critical: 1 },
        userDecision: 'fix',
        action: 'fixed',
      },
      {
        timestamp: '2026-03-21T09:00:00.000Z',
        commitHash: 'def456',
        filesScanned: ['tests/sample.env'],
        findings: [
          {
            ruleId: 'stripe-live-secret',
            ruleName: 'Stripe Live Secret Key',
            severity: 'critical',
            lineNumber: 3,
            status: 'open',
          },
        ],
        findingCount: 1,
        severityCounts: { critical: 1 },
        userDecision: 'none',
        action: 'none',
      },
    ],
    ...overrides,
  };
}

function makeIncidentRecord() {
  return {
    id: 'gate-inc-20260321-001',
    dateDetected: '2026-03-21T08:30:00.000Z',
    severity: 'Critical',
    summary: 'AWS access key exposed in source repository.',
    timeline: [
      { time: '2026-03-21T08:30:00.000Z', event: 'Secret detected by Gate scanner' },
      { time: '2026-03-21T08:45:00.000Z', event: 'Credential verified as live via API' },
      { time: '2026-03-21T09:00:00.000Z', event: 'Key rotated in AWS IAM console' },
    ],
    actionsTaken: [
      { description: 'Credential rotated', done: true },
      { description: 'Access logs reviewed', done: true },
      { description: 'Git history scrubbed', done: false },
    ],
    complianceRefs: ['OWASP A02:2021', 'NIST SC-12'],
    recommendations: [
      'Enable AWS CloudTrail for all API calls',
      'Adopt IAM roles instead of long-lived access keys',
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateComplianceReport', () => {
  test('Markdown report has title and date', () => {
    const report = generateComplianceReport(makeAuditData());
    expect(report).toContain('# Gate Security Compliance Report');
    expect(report).toMatch(/\d{4}-\d{2}-\d{2}/); // date pattern
  });

  test('Markdown report has executive summary with counts', () => {
    const report = generateComplianceReport(makeAuditData());
    expect(report).toMatch(/executive summary/i);
    expect(report).toMatch(/total.*finding/i);
  });

  test('Markdown report has findings table with correct columns', () => {
    const report = generateComplianceReport(makeAuditData());
    expect(report).toContain('| File |');
    expect(report).toContain('Rule');
    expect(report).toContain('Severity');
    expect(report).toContain('Status');
  });

  test('Markdown report has compliance framework section', () => {
    const report = generateComplianceReport(makeAuditData());
    expect(report).toMatch(/compliance/i);
    expect(report).toMatch(/OWASP|NIST|CIS|SOC2/);
  });

  test('Report with zero findings generates successfully', () => {
    const emptyData = makeAuditData({ entries: [] });
    let report;
    expect(() => {
      report = generateComplianceReport(emptyData);
    }).not.toThrow();
    expect(report).toContain('# Gate Security Compliance Report');
    expect(report).toMatch(/0.*finding|no finding/i);
  });
});

describe('generateHTMLReport', () => {
  test('HTML report has required structural elements', () => {
    const html = generateHTMLReport(makeAuditData());
    expect(html).toContain('<html');
    expect(html).toContain('<head');
    expect(html).toContain('<body');
    expect(html).toContain('<style');
  });

  test('HTML report contains the same key data as Markdown version', () => {
    const auditData = makeAuditData();
    const html = generateHTMLReport(auditData);
    const md = generateComplianceReport(auditData);

    // Both should mention the same rule names
    expect(html).toContain('AWS Access Key ID');
    expect(html).toContain('Stripe Live Secret Key');
    // HTML should have the compliance section
    expect(html).toMatch(/OWASP|NIST|CIS|SOC2/);
    // Markdown should also have these
    expect(md).toContain('AWS Access Key ID');
    expect(md).toContain('Stripe Live Secret Key');
  });

  test('Zero findings generates valid HTML', () => {
    const emptyData = makeAuditData({ entries: [] });
    let html;
    expect(() => {
      html = generateHTMLReport(emptyData);
    }).not.toThrow();
    expect(html).toContain('<html');
    expect(html).toContain('Gate Security Compliance Report');
  });
});

describe('generateSARIF', () => {
  test('SARIF output has correct $schema and version', () => {
    const sarif = generateSARIF(makeScanResults());
    expect(sarif['$schema']).toBe(
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json'
    );
    expect(sarif.version).toBe('2.1.0');
  });

  test('SARIF output has tool.driver with name "Gate"', () => {
    const sarif = generateSARIF(makeScanResults());
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('Gate');
    expect(sarif.runs[0].tool.driver.version).toBeDefined();
  });

  test('SARIF output results include startLine AND startColumn', () => {
    const sarif = generateSARIF(makeScanResults());
    const results = sarif.runs[0].results;
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      const region = result.locations[0].physicalLocation.region;
      expect(region.startLine).toBeDefined();
      expect(typeof region.startLine).toBe('number');
      expect(region.startColumn).toBeDefined();
      expect(typeof region.startColumn).toBe('number');
    }
  });

  test('SARIF output includes verification in properties bag when available', () => {
    const sarif = generateSARIF(makeScanResults());
    const results = sarif.runs[0].results;

    // First finding (aws-access-key-id) has verification: { status: 'live' }
    const verifiedResult = results.find(
      (r) => r.ruleId === 'aws-access-key-id'
    );
    expect(verifiedResult).toBeDefined();
    expect(verifiedResult.properties).toBeDefined();
    expect(verifiedResult.properties.verification).toBeDefined();
  });

  test('SARIF rules include shortDescription and help fields', () => {
    const sarif = generateSARIF(makeScanResults());
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.id).toBeDefined();
      expect(rule.shortDescription).toBeDefined();
      expect(rule.shortDescription.text).toBeDefined();
      expect(rule.help).toBeDefined();
      expect(rule.help.text).toBeDefined();
    }
  });
});

describe('generateJSONReport', () => {
  test('JSON report has all required top-level fields', () => {
    const report = generateJSONReport(makeScanResults());
    expect(report.version).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.findings).toBeDefined();
    expect(report.summary).toBeDefined();
  });

  test('JSON report summary counts match findings array', () => {
    const scanResults = makeScanResults();
    const report = generateJSONReport(scanResults);

    const totalFindings = scanResults.filesScanned.reduce(
      (sum, f) => sum + f.findings.length,
      0
    );

    expect(report.findings).toHaveLength(totalFindings);
    expect(report.summary.totalFindings).toBe(totalFindings);
    expect(report.summary.filesScanned).toBe(scanResults.filesScanned.length);
  });

  test('JSON report summary severity counts are accurate', () => {
    const report = generateJSONReport(makeScanResults());
    // 2 critical (aws + stripe) + 1 high (github)
    expect(report.summary.critical).toBe(2);
    expect(report.summary.high).toBe(1);
  });

  test('Zero findings generates valid JSON report', () => {
    const emptyScan = { filesScanned: [] };
    let report;
    expect(() => {
      report = generateJSONReport(emptyScan);
    }).not.toThrow();
    expect(report.findings).toHaveLength(0);
    expect(report.summary.totalFindings).toBe(0);
  });

  test('JSON report preserves verification status from enriched findings', () => {
    const scanResults = makeScanResults();
    const enrichedFindings = scanResults.filesScanned.flatMap((fileResult) =>
      fileResult.findings.map((finding) => ({
        ...finding,
        file: fileResult.file,
      }))
    );

    enrichedFindings[0].verification = { status: 'inactive', details: {} };
    const report = generateJSONReport(scanResults, { findings: enrichedFindings });

    expect(report.findings[0].verification).toBe('inactive');
    expect(report.summary.verified.inactive).toBe(2);
  });
});

describe('generateIncidentReport', () => {
  test('Incident report has required header fields', () => {
    const report = generateIncidentReport(makeIncidentRecord());
    expect(report).toContain('# Security Incident Report');
    expect(report).toContain('gate-inc-20260321-001');
    expect(report).toContain('Critical');
  });

  test('Incident report has timeline table', () => {
    const report = generateIncidentReport(makeIncidentRecord());
    expect(report).toContain('## Timeline');
    expect(report).toContain('| Time |');
    expect(report).toContain('| Event |');
    // Should contain timeline events
    expect(report).toContain('Secret detected by Gate scanner');
  });

  test('Incident report has actions taken section', () => {
    const report = generateIncidentReport(makeIncidentRecord());
    expect(report).toContain('## Actions Taken');
    expect(report).toContain('Credential rotated');
    expect(report).toContain('Git history scrubbed');
  });
});
