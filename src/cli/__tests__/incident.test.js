'use strict';

/**
 * Tests for src/cli/incident.js — Incident Response Workflow
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFinding(overrides = {}) {
  return {
    ruleId: 'aws-access-key-id',
    ruleName: 'AWS Access Key ID',
    severity: 'critical',
    type: 'pattern',
    lineNumber: 42,
    match: 'AKIAIOSFODNN7EXAMPLE',
    file: '/project/src/config.js',
    ...overrides,
  };
}

let incident;
let execFileSync;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  incident = require('../incident');
  // Re-acquire execFileSync from the mocked child_process after resetModules
  execFileSync = require('child_process').execFileSync;
});

// ─── 1. detectProviderCLI: AWS CLI installed ─────────────────────────────────

describe('detectProviderCLI', () => {
  test('1. returns cli and version when AWS CLI is installed', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'which' && args[0] === 'aws') return '/usr/local/bin/aws';
      if (cmd === 'aws' && args[0] === '--version') return 'aws-cli/2.15.0 Python/3.11.6';
      throw new Error('unexpected command');
    });

    const result = incident.detectProviderCLI('aws');

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('cli', 'aws');
    expect(result).toHaveProperty('version');
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
  });

  // ─── 2. detectProviderCLI: AWS CLI not installed ──────────────────────────

  test('2. returns null when AWS CLI is not installed', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = incident.detectProviderCLI('aws');

    expect(result).toBeNull();
  });

  // ─── 3. detectProviderCLI: Slack has no CLI ───────────────────────────────

  test('3. returns null for providers with no CLI (Slack)', () => {
    // execFileSync should never be called for Slack since it has no CLI
    const result = incident.detectProviderCLI('slack');
    expect(result).toBeNull();
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

// ─── 4. generateRotationSteps: GitHub ─────────────────────────────────────

describe('generateRotationSteps', () => {
  test('4. GitHub rotation steps include correct URL and web steps', () => {
    const steps = incident.generateRotationSteps('github-pat');

    expect(steps).toHaveProperty('provider', 'github');
    expect(steps).toHaveProperty('webUrl');
    expect(steps.webUrl).toContain('github.com');
    expect(steps).toHaveProperty('webSteps');
    expect(steps.webSteps).toBeTruthy();
    expect(typeof steps.webSteps).toBe('string');
  });

  // ─── 5. generateRotationSteps: Stripe has CLI command ───────────────────

  test('5. Stripe rotation steps include CLI command', () => {
    const steps = incident.generateRotationSteps('stripe-live-secret');

    expect(steps).toHaveProperty('provider', 'stripe');
    expect(steps).toHaveProperty('commands');
    expect(Array.isArray(steps.commands)).toBe(true);
    expect(steps.commands.length).toBeGreaterThan(0);
    expect(steps.commands.some(cmd => cmd.includes('stripe'))).toBe(true);
  });
});

// ─── 6. generateAuditGuidance: Stripe ────────────────────────────────────

describe('generateAuditGuidance', () => {
  test('6. Stripe audit guidance includes dashboard.stripe.com/logs', () => {
    const guidance = incident.generateAuditGuidance('stripe-live-secret');

    expect(guidance).toHaveProperty('provider', 'stripe');
    expect(guidance).toHaveProperty('dashboardUrl');
    expect(guidance.dashboardUrl).toContain('dashboard.stripe.com');
    expect(guidance).toHaveProperty('instructions');
    expect(typeof guidance.instructions).toBe('string');
  });
});

// ─── 7. generatePurgeScript: contains git-filter-repo command ────────────

describe('generatePurgeScript', () => {
  test('7. includes git-filter-repo command with correct secret replacement', () => {
    const finding = makeFinding({ match: 'AKIAIOSFODNN7EXAMPLE' });
    const script = incident.generatePurgeScript(finding, '/project');

    expect(typeof script).toBe('string');
    expect(script).toContain('git-filter-repo');
    expect(script).toContain('REDACTED_BY_GATE');
    // Script no longer contains raw secrets — they are in the replacements file
    expect(script).toContain('replace-text');
    expect(script).toContain('REPLACEMENTS_FILE');
  });

  // ─── 8. generatePurgeScript: force-push is commented out ─────────────

  test('8. does NOT include uncommented force-push command', () => {
    const finding = makeFinding({ match: 'AKIAIOSFODNN7EXAMPLE' });
    const script = incident.generatePurgeScript(finding, '/project');

    // Split into lines and find force-push lines
    const lines = script.split('\n');
    const forcePushLines = lines.filter(line =>
      line.includes('push') && line.includes('--force')
    );

    // All force-push lines must be commented out (start with # possibly with whitespace)
    for (const line of forcePushLines) {
      expect(line.trim()).toMatch(/^#/);
    }
  });
});

// ─── 9. createIncidentRecord: writes JSON to ~/.gate/incidents/ ──────────

describe('createIncidentRecord', () => {
  let tempIncidentDir;
  let originalHome;

  beforeEach(() => {
    // Redirect os.homedir() by mocking the incidents path used internally
    tempIncidentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-incident-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempIncidentDir, { recursive: true, force: true });
  });

  test('9. writes JSON incident record to ~/.gate/incidents/', () => {
    const finding = makeFinding({
      ruleId: 'aws-access-key-id',
      ruleName: 'AWS Access Key ID',
      match: 'AKIAIOSFODNN7EXAMPLE',
      lineNumber: 42,
      file: '/project/src/config.js',
    });

    const exposureWindow = {
      firstCommit: '2026-03-01T00:00:00Z',
      detected: new Date().toISOString(),
      durationDays: 20,
    };

    // Use a custom incidentsDir so we don't pollute real ~/.gate/incidents
    const incidentsDir = path.join(tempIncidentDir, 'incidents');
    const record = incident.createIncidentRecord(finding, exposureWindow, { incidentsDir });

    expect(record).toHaveProperty('id');
    expect(record.id).toMatch(/^gate-inc-\d{8}-\d{3}$/);
    expect(record).toHaveProperty('detectedAt');
    expect(record).toHaveProperty('secretType');
    expect(record).toHaveProperty('ruleId', 'aws-access-key-id');
    expect(record).toHaveProperty('file', '/project/src/config.js');
    expect(record).toHaveProperty('line', 42);
    expect(record).toHaveProperty('exposure', 'pushed');
    expect(record).toHaveProperty('exposureWindow');
    expect(record).toHaveProperty('actions');
    expect(record.actions).toHaveProperty('rotated', false);
    expect(record.actions).toHaveProperty('accessLogsReviewed', false);
    expect(record.actions).toHaveProperty('codeFixed', false);
    expect(record).toHaveProperty('compliance');

    // Verify file was written
    const files = fs.readdirSync(incidentsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^gate-inc-\d{8}-\d{3}\.json$/);

    const written = JSON.parse(fs.readFileSync(path.join(incidentsDir, files[0]), 'utf8'));
    expect(written.id).toBe(record.id);
    expect(written.ruleId).toBe('aws-access-key-id');
  });
});

// ─── 10. generateIncidentReport: produces valid Markdown ─────────────────

describe('generateIncidentReport', () => {
  let tempIncidentDir;

  beforeEach(() => {
    tempIncidentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempIncidentDir, { recursive: true, force: true });
  });

  test('10. produces valid Markdown with timeline and actions', () => {
    const incidentsDir = path.join(tempIncidentDir, 'incidents');
    fs.mkdirSync(incidentsDir, { recursive: true });

    // Write a fake incident record
    const incidentId = 'gate-inc-20260321-001';
    const record = {
      id: incidentId,
      detectedAt: '2026-03-21T12:00:00Z',
      secretType: 'AWS Access Key ID',
      ruleId: 'aws-access-key-id',
      file: '/project/src/config.js',
      line: 42,
      exposure: 'pushed',
      exposureWindow: {
        firstCommit: '2026-03-01T00:00:00Z',
        detected: '2026-03-21T12:00:00Z',
        durationDays: 20,
      },
      actions: {
        rotated: true,
        accessLogsReviewed: false,
        codeFixed: true,
        historyPurged: 'pending',
      },
      compliance: {
        owasp: ['A02:2021 – Cryptographic Failures'],
        nist: ['NIST SP 800-53 IA-5'],
        cis: ['CIS Control 3.9'],
        soc2: ['CC6.1'],
      },
    };

    const incidentFile = path.join(incidentsDir, `${incidentId}.json`);
    fs.writeFileSync(incidentFile, JSON.stringify(record, null, 2));

    const report = incident.generateIncidentReport(incidentId, { incidentsDir });

    expect(typeof report).toBe('string');
    // Must be Markdown: has heading
    expect(report).toMatch(/^#/m);
    // Must include the incident ID
    expect(report).toContain(incidentId);
    // Must include timeline section
    expect(report).toMatch(/timeline|Timeline/i);
    // Must include actions section
    expect(report).toMatch(/actions|Actions/i);
    // Must include compliance references
    expect(report).toMatch(/compliance|Compliance/i);
    // Must include the file path
    expect(report).toContain('/project/src/config.js');
    // Must include secret type
    expect(report).toMatch(/AWS Access Key/i);
  });
});
