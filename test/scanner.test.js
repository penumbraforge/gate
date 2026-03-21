/**
 * Tests for Gate scanner
 * Comprehensive unit and integration tests
 */

const scanner = require('../src/cli/scanner');
const rules = require('../src/cli/rules');
const audit = require('../src/cli/audit');
const installer = require('../src/cli/installer');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Rules', () => {
  test('should have 50+ secret patterns', () => {
    const allRules = rules.getRules();
    const patternRules = rules.getPatternRules();

    expect(allRules.length).toBeGreaterThanOrEqual(50);
    expect(patternRules.length).toBeGreaterThanOrEqual(50);
  });

  test('should have all required rule properties', () => {
    const allRules = rules.getRules();

    for (const rule of allRules) {
      expect(rule.id).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(rule.severity).toBeDefined();
      expect(['critical', 'high', 'medium', 'low']).toContain(rule.severity);
    }
  });

  test('should retrieve rule by ID', () => {
    const rule = rules.getRuleById('aws-access-key-id');
    expect(rule).toBeDefined();
    expect(rule.id).toBe('aws-access-key-id');
  });

  test('should retrieve rules by severity', () => {
    const critical = rules.getRulesBySeverity('critical');
    expect(critical.length).toBeGreaterThan(0);
    for (const rule of critical) {
      expect(rule.severity).toBe('critical');
    }
  });
});

describe('Entropy Calculation', () => {
  test('should calculate entropy correctly', () => {
    const entropy = scanner.calculateEntropy('aaaaa');
    expect(entropy).toBe(0); // All same character

    const entropy2 = scanner.calculateEntropy('abcdefghijklmnop');
    expect(entropy2).toBeGreaterThan(3); // More random
  });

  test('should identify high-entropy strings', () => {
    const random = 'aB3xK9mP2qL7wR5tY';
    const entropy = scanner.calculateEntropy(random);
    expect(entropy).toBeGreaterThan(3.5);
  });

  test('should identify low-entropy strings', () => {
    const low = 'aaaaaabbbbbcccccc';
    const entropy = scanner.calculateEntropy(low);
    expect(entropy).toBeLessThan(2);
  });
});

describe('Pattern Detection', () => {
  test('should detect AWS access keys', () => {
    const content = 'aws_key = "AKIAIOSFODNN7EXAMPLE"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.ruleId === 'aws-access-key-id')).toBe(true);
  });

  test('should detect GitHub tokens', () => {
    const content = 'token = "ghp_abcdef1234567890abcdef1234567890abc"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'github-pat')).toBe(true);
  });

  test('should detect Stripe keys', () => {
    const content = 'stripe_key = "sk_live_00000000000000000000000000"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'stripe-live-secret')).toBe(true);
  });

  test('should detect Slack tokens', () => {
    const content = 'slack_token = "xoxb-0000000000-000000000000000"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'slack-bot-token')).toBe(true);
  });

  test('should detect private keys', () => {
    const content = 'key = "-----BEGIN PRIVATE KEY-----"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'private-key-generic')).toBe(true);
  });

  test('should detect RSA private keys', () => {
    const content = 'key = "-----BEGIN RSA PRIVATE KEY-----"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'private-key-rsa')).toBe(true);
  });

  test('should detect MongoDB connection strings', () => {
    const content = 'mongodb://user:pass@localhost:27017/db';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'mongodb-uri')).toBe(true);
  });

  test('should detect password assignments', () => {
    const content = 'password = "mysecretpassword123"';
    const findings = scanner.scanForPatterns(content, 1);

    expect(findings.some((f) => f.ruleId === 'password-assignment')).toBe(true);
  });

  test('should return line numbers', () => {
    const content = 'normal line\nsecret = "AKIAIOSFODNN7EXAMPLE"\nanother line';
    const findings = scanner.scanForPatterns(content.split('\n')[1], 2);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].lineNumber).toBe(2);
  });
});

describe('File Scanning', () => {
  test('should scan a file with secrets', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-secret.js');
    const content = 'const apiKey = "AKIAIOSFODNN7EXAMPLE";';

    fs.writeFileSync(tmpFile, content);

    try {
      const result = scanner.scanFile(tmpFile);

      expect(result.file).toBe(tmpFile);
      expect(result.isBinary).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test('should handle non-existent files', () => {
    const result = scanner.scanFile('/nonexistent/path/file.js');

    expect(result.error).toBeDefined();
    expect(result.error).toContain('not found');
  });

  test('should detect binary files', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-binary.bin');
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    fs.writeFileSync(tmpFile, buffer);

    try {
      const result = scanner.scanFile(tmpFile);

      expect(result.isBinary).toBe(true);
      expect(result.findings.length).toBe(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('Multiple File Scanning', () => {
  test('should scan multiple files and aggregate results', () => {
    const files = [];

    try {
      // Create test files
      for (let i = 0; i < 3; i++) {
        const tmpFile = path.join(os.tmpdir(), `test-multi-${i}.js`);
        fs.writeFileSync(tmpFile, `const secret${i} = "AKIA${i}OSFODNN7EXAMPLE";`);
        files.push(tmpFile);
      }

      const results = scanner.scanFiles(files);

      expect(results.filesScanned.length).toBe(3);
      expect(results.totalFindings).toBeGreaterThan(0);
      expect(results.severityCounts.critical).toBeGreaterThan(0);
    } finally {
      for (const file of files) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
    }
  });
});

describe('Audit Logging', () => {
  let testAuditPath;

  beforeAll(() => {
    testAuditPath = path.join(os.tmpdir(), 'test-audit.jsonl');
    // Backup and override AUDIT_LOG_PATH for testing
    jest.doMock('../src/cli/audit', () => ({
      ...jest.requireActual('../src/cli/audit'),
      AUDIT_LOG_PATH: testAuditPath,
    }));
  });

  afterEach(() => {
    if (fs.existsSync(testAuditPath)) {
      fs.unlinkSync(testAuditPath);
    }
  });

  test('should record audit entries', () => {
    const entry = {
      commitHash: 'abc123',
      filesScanned: ['test.js'],
      findings: [
        {
          ruleId: 'aws-access-key-id',
          ruleName: 'AWS Access Key ID',
          severity: 'critical',
          file: 'test.js',
          lineNumber: 1,
          match: 'AKIAIOSFODNN7EXAMPLE',
        },
      ],
      severityCounts: { critical: 1, high: 0, medium: 0, low: 0 },
      userDecision: 'bypass',
    };

    const recorded = audit.recordScan(entry);
    expect(recorded).toBe(true);
  });

  test('should verify audit log integrity', () => {
    const entry = {
      commitHash: 'abc123',
      filesScanned: ['test.js'],
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      userDecision: 'approved',
    };

    audit.recordScan(entry);

    const verification = audit.verifyIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.entriesChecked).toBeGreaterThan(0);
  });

  test('should query audit log', () => {
    for (let i = 0; i < 3; i++) {
      audit.recordScan({
        commitHash: `commit${i}`,
        filesScanned: [`file${i}.js`],
        findings: [],
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        userDecision: i === 0 ? 'bypass' : 'approved',
      });
    }

    const bypassed = audit.queryAuditLog({ decision: 'bypass' });
    expect(bypassed.length).toBeGreaterThan(0);
    expect(bypassed[0].userDecision).toBe('bypass');
  });

  test('should export audit log as JSON', () => {
    audit.recordScan({
      commitHash: 'abc123',
      filesScanned: ['test.js'],
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      userDecision: 'approved',
    });

    const exported = audit.exportAuditLog('json');
    const parsed = JSON.parse(exported);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('should export audit log as CSV', () => {
    audit.recordScan({
      commitHash: 'abc123',
      filesScanned: ['test.js'],
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      userDecision: 'approved',
    });

    const exported = audit.exportAuditLog('csv');
    expect(typeof exported).toBe('string');
    expect(exported).toContain('timestamp');
    expect(exported).toContain('abc123');
  });

  test('should get statistics', () => {
    audit.recordScan({
      commitHash: 'abc123',
      filesScanned: ['test.js'],
      findings: [{ ruleId: 'aws', severity: 'critical' }],
      severityCounts: { critical: 1, high: 0, medium: 0, low: 0 },
      userDecision: 'bypass',
    });

    const stats = audit.getStatistics();

    expect(stats.totalScans).toBeGreaterThan(0);
    expect(stats.severityTotals.critical).toBeGreaterThan(0);
  });
});

describe('Entropy Detection', () => {
  test('should skip very short strings', () => {
    const short = 'abc';
    expect(scanner.shouldScanForEntropy(short)).toBe(false);
  });

  test('should skip URLs', () => {
    const url = 'https://example.com/very/long/path/here/with/many/segments';
    expect(scanner.shouldScanForEntropy(url)).toBe(false);
  });

  test('should skip HTML/XML', () => {
    const html = '<div class="very-long-class-name-here">content</div>';
    expect(scanner.shouldScanForEntropy(html)).toBe(false);
  });

  test('should scan legitimate random strings', () => {
    const random = 'aB3xK9mP2qL7wR5tY8vZ0cD4eF6gH1jI5kM';
    expect(scanner.shouldScanForEntropy(random)).toBe(true);
  });
});

describe('Installer', () => {
  test('should detect git root', () => {
    // This test should run within the project directory
    const gitRoot = installer.findGitRoot();
    // May return null if not in a git repo, but shouldn't throw
    expect(gitRoot === null || typeof gitRoot === 'string').toBe(true);
  });

  test('should generate valid hook script', () => {
    const script = installer.generateHookScript();

    expect(script).toContain('#!/bin/sh');
    expect(script).toContain('gate');
    expect(script).toContain('node');
  });
});
