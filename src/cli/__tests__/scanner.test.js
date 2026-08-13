const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-scanner-test-'));
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('scanner config/ignore integration', () => {
  let scanner;

  beforeEach(() => {
    jest.resetModules();
    scanner = require('../scanner');
  });

  test('respects .gateignore file patterns — skips ignored files', () => {
    const dir = createTempDir();
    try {
      // Create .gateignore containing 'test/**'
      fs.writeFileSync(path.join(dir, '.gateignore'), 'test/**\n');

      // Create a file test/fixture.js with a fake secret
      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      const secretFile = path.join(dir, 'test', 'fixture.js');
      fs.writeFileSync(secretFile, 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

      // Scan it with config dir pointing at our temp dir
      const results = scanner.scanFiles([secretFile], { configDir: dir });

      // File should be skipped entirely — 0 findings
      const fileResult = results.filesScanned.find(f => f.file === secretFile);
      expect(fileResult.findings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('respects inline gate-ignore comments', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'secret.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE"; // gate-ignore\n');

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      // The line with gate-ignore should produce 0 findings
      expect(fileResult.findings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('respects severity overrides from config — ignore suppresses', () => {
    const dir = createTempDir();
    try {
      // Create .gaterc that sets aws-access-key-id severity to 'ignore'
      fs.writeFileSync(
        path.join(dir, '.gaterc'),
        'severity:\n  aws-access-key-id: ignore\n'
      );

      const filePath = path.join(dir, 'aws.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      // aws-access-key-id findings should be suppressed
      const awsFindings = fileResult.findings.filter(
        f => f.ruleId === 'aws-access-key-id'
      );
      expect(awsFindings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('applies custom rules from .gaterc', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(
        path.join(dir, '.gaterc'),
        [
          'rules:',
          '  - id: acme-key',
          '    name: ACME Secret Key',
          '    pattern: "ACME-[A-Z0-9]{20}"',
          '    severity: high',
        ].join('\n') + '\n'
      );

      const filePath = path.join(dir, 'app.js');
      fs.writeFileSync(filePath, 'const key = "ACME-ABCDEFGHIJ1234567890";\n');

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      const acmeFindings = fileResult.findings.filter(
        f => f.ruleId === 'acme-key'
      );
      expect(acmeFindings.length).toBeGreaterThanOrEqual(1);
      expect(acmeFindings[0].severity).toBe('high');
    } finally {
      cleanDir(dir);
    }
  });

  test('uses per-file-type entropy thresholds — .env has lower threshold', () => {
    const dir = createTempDir();
    try {
      // Generate a string with entropy around 4.7 — above 4.5 (.env/config
      // threshold) but below 4.8 (source code threshold).
      // 26 distinct characters => entropy = log2(26) ≈ 4.70
      const medEntropy = 'aB1cD2eF3gH4iJ5kL6mN7oP8qR';

      // Verify the entropy is in the right range
      const ent = scanner.calculateEntropy(medEntropy);
      expect(ent).toBeGreaterThanOrEqual(4.5);
      expect(ent).toBeLessThan(4.8);

      // Create .env file and .js file with same content
      const envFile = path.join(dir, '.env');
      const jsFile = path.join(dir, 'app.js');

      fs.writeFileSync(envFile, `SOME_VALUE="${medEntropy}"\n`);
      fs.writeFileSync(jsFile, `const s = "${medEntropy}";\n`);

      const envResults = scanner.scanFile(envFile, { configDir: dir });
      const jsResults = scanner.scanFile(jsFile, { configDir: dir });

      const envEntropyFindings = envResults.findings.filter(
        f => f.type === 'entropy'
      );
      const jsEntropyFindings = jsResults.findings.filter(
        f => f.type === 'entropy'
      );

      // Should be flagged in .env (threshold 4.5) but not in .js (threshold 4.8)
      expect(envEntropyFindings.length).toBeGreaterThanOrEqual(1);
      expect(jsEntropyFindings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('handles empty files without error', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'empty.js');
      fs.writeFileSync(filePath, '');

      const results = scanner.scanFile(filePath, { configDir: dir });

      expect(results.findings).toHaveLength(0);
      expect(results.error).toBeNull();
    } finally {
      cleanDir(dir);
    }
  });

  test('handles files with no newline at end', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'no-newline.js');
      // Write content with no trailing newline and a detectable secret on last line
      fs.writeFileSync(filePath, 'const a = 1;\nconst key = "AKIAIOSFODNN7EXAMPLE";');

      const results = scanner.scanFile(filePath, { configDir: dir });

      // Should still detect the secret on the last line
      const awsFindings = results.findings.filter(
        f => f.ruleId === 'aws-access-key-id'
      );
      expect(awsFindings.length).toBeGreaterThanOrEqual(1);
      expect(awsFindings[0].lineNumber).toBe(2);
    } finally {
      cleanDir(dir);
    }
  });

  test('scanAll returns results for all tracked files', () => {
    const dir = createTempDir();
    const origCwd = process.cwd();
    try {
      process.chdir(dir);

      // Initialize a git repo
      execSync('git init', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });

      // Create files and add to git
      fs.writeFileSync(path.join(dir, 'clean.js'), 'const x = 1;\n');
      fs.writeFileSync(path.join(dir, 'secret.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
      execSync('git add .', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "init"', { cwd: dir, stdio: 'ignore' });

      const results = scanner.scanAll({ configDir: dir });

      expect(results.filesScanned.length).toBe(2);
      expect(results.totalFindings).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
      cleanDir(dir);
    }
  });

  test('shouldIgnoreFinding filters rule-specific patterns from results', () => {
    const dir = createTempDir();
    try {
      // Create .gateignore that suppresses aws-access-key-id in test files
      fs.writeFileSync(
        path.join(dir, '.gateignore'),
        '[rule:aws-access-key-id] test/**\n'
      );

      // File path relative to configDir simulating test/secret.js
      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      const filePath = path.join(dir, 'test', 'secret.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      const awsFindings = fileResult.findings.filter(
        f => f.ruleId === 'aws-access-key-id'
      );
      expect(awsFindings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('severity override changes finding severity', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(
        path.join(dir, '.gaterc'),
        'severity:\n  aws-access-key-id: low\n'
      );

      const filePath = path.join(dir, 'aws.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      const awsFindings = fileResult.findings.filter(
        f => f.ruleId === 'aws-access-key-id'
      );
      expect(awsFindings.length).toBeGreaterThanOrEqual(1);
      expect(awsFindings[0].severity).toBe('low');
    } finally {
      cleanDir(dir);
    }
  });
});

describe('file size guard', () => {
  let scanner;

  beforeEach(() => {
    jest.resetModules();
    scanner = require('../scanner');
  });

  test('skips files exceeding maxFileSize', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'large.js');
      // Create a 3MB file with a secret on the first line
      const secret = 'const key = "AKIAIOSFODNN7EXAMPLE";\n';
      const padding = 'x'.repeat(1024) + '\n';
      const content = secret + padding.repeat(3 * 1024);
      fs.writeFileSync(filePath, content);

      const results = scanner.scanFile(filePath, { maxFileSize: 2 * 1024 * 1024 });

      expect(results.skipped).toBe(true);
      expect(results.skipReason).toMatch(/exceeds limit/);
      expect(results.findings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('scans files under the size limit normally', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'small.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

      const results = scanner.scanFile(filePath, { maxFileSize: 2 * 1024 * 1024 });

      expect(results.skipped).toBeUndefined();
      expect(results.findings.length).toBeGreaterThan(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('uses default 2MB limit when maxFileSize not specified', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'large.js');
      // Create a file just over 2MB
      const content = 'x'.repeat(2 * 1024 * 1024 + 1);
      fs.writeFileSync(filePath, content);

      const results = scanner.scanFile(filePath, {});

      expect(results.skipped).toBe(true);
      expect(results.skipReason).toMatch(/exceeds limit/);
    } finally {
      cleanDir(dir);
    }
  });

  test('scanFiles propagates maxFileSize from config', () => {
    const dir = createTempDir();
    try {
      // Create .gaterc with max_file_size
      fs.writeFileSync(path.join(dir, '.gaterc'), 'max_file_size: 1KB\n');

      const filePath = path.join(dir, 'medium.js');
      // Create a 2KB file
      fs.writeFileSync(filePath, 'x'.repeat(2048));

      const results = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = results.filesScanned.find(f => f.file === filePath);

      expect(fileResult.skipped).toBe(true);
      expect(fileResult.skipReason).toMatch(/exceeds limit/);
    } finally {
      cleanDir(dir);
    }
  });

  test('formatBytes returns human-readable sizes', () => {
    expect(scanner.formatBytes(500)).toBe('500B');
    expect(scanner.formatBytes(1024)).toBe('1KB');
    expect(scanner.formatBytes(1536)).toBe('1.5KB');
    expect(scanner.formatBytes(1048576)).toBe('1MB');
    expect(scanner.formatBytes(4404019)).toBe('4.2MB');
    expect(scanner.formatBytes(1073741824)).toBe('1GB');
  });

  test('scans large single-line files without pathological slowdown', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'huge-single-line.js');
      fs.writeFileSync(filePath, 'x'.repeat(600 * 1024));

      const startedAt = Date.now();
      const results = scanner.scanFile(filePath, {});
      const elapsedMs = Date.now() - startedAt;

      expect(results.error).toBeNull();
      expect(elapsedMs).toBeLessThan(2000);
    } finally {
      cleanDir(dir);
    }
  });

  test('detects secrets embedded in very long single lines', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'bundle.js');
      const content = 'x'.repeat(20_000) + 'AKIAIOSFODNN7EXAMPLE' + 'y'.repeat(20_000);
      fs.writeFileSync(filePath, content);

      const results = scanner.scanFile(filePath, {});

      expect(results.findings.some(
        (finding) => finding.ruleId === 'aws-access-key-id'
      )).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });
});

describe('multiline secret detection', () => {
  let scanner;

  beforeEach(() => {
    jest.resetModules();
    scanner = require('../scanner');
  });

  function scanContent(content, filename = 'test.js') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content);
    const result = scanner.scanFile(filePath, {});
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
    return result;
  }

  test('detects AKIA key in template literal', () => {
    const content = 'const key = `AKIAIOSFODNN7EXAMPLE`;';
    const result = scanContent(content);
    expect(result.findings.some(f => f.ruleId === 'aws-access-key-id')).toBe(true);
  });

  test('detects secret in concatenated strings', () => {
    const content = `const key = "AKIA" + "IOSFODNN7EXAMPLE";`;
    const result = scanContent(content);
    expect(result.findings.some(f =>
      f.ruleId === 'aws-access-key-id' && f.multiline === true
    )).toBe(true);
  });

  test('does not flag normal template literals', () => {
    const content = 'const msg = `Hello world, this is a normal template string with no secrets at all here`;';
    const result = scanContent(content);
    expect(result.findings.filter(f => f.multiline)).toHaveLength(0);
  });

  test('does not flag normal string concatenation', () => {
    const content = `const msg = "Hello " + "world!!!";`;
    const result = scanContent(content);
    expect(result.findings).toHaveLength(0);
  });

  test('skips multiline extraction on large files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const filePath = path.join(tmpDir, 'huge.js');
    fs.writeFileSync(filePath, 'x'.repeat(600 * 1024));
    const result = scanner.scanFile(filePath, {});
    expect(result.error).toBeNull();
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
  });

  test('detects base64 blocks spanning multiple lines', () => {
    const b64Line = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=';
    const content = `secret =\n${b64Line}\n${b64Line}\n${b64Line}\n`;
    const result = scanContent(content);
    // Should detect as multiline entropy (base64 block after assignment context)
    expect(result.findings.some(f => f.multiline === true)).toBe(true);
  });
});

describe('entropy false-positive guards', () => {
  let scanner;

  beforeEach(() => {
    jest.resetModules();
    scanner = require('../scanner');
  });

  test('JSON with UUIDs, file paths, and prose produces 0 findings', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'fixture.json');
      const content = JSON.stringify({
        requestId: '9f8b7c6d-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
        correlationId: 'DEADBEEF-CAFE-4B1D-8000-0123456789AB',
        binaryPath: '/usr/local/lib/node_modules/@penumbraforge/gate/bin/gate.js',
        cachePath: '/Users/someone/Library/Caches/gate/update-check.json',
        description: 'A perfectly ordinary English sentence describing the config.',
        note: 'ThisValueMixesCaseButIsJustWordsGluedTogetherNicely',
      }, null, 2);
      fs.writeFileSync(filePath, content);

      const results = scanner.scanFile(filePath, { configDir: dir });
      expect(results.findings).toHaveLength(0);
    } finally {
      cleanDir(dir);
    }
  });

  test('.env with a real 40-char base64-ish secret is still detected', () => {
    const dir = createTempDir();
    try {
      // High-entropy 40-char mixed-case+digits value (entropy > 4.5)
      const secret = 'tr8xPqm2VbLw9ZkYd3RfCnJ0hG5sQxTe4uHiOp1A';
      const ent = scanner.calculateEntropy(secret);
      expect(ent).toBeGreaterThanOrEqual(4.5);

      const filePath = path.join(dir, '.env');
      // Variable name chosen so only the entropy rule (not env-var-secret) fires
      fs.writeFileSync(filePath, `DB_CONN="${secret}"\n`);

      const results = scanner.scanFile(filePath, { configDir: dir });
      const entropyFindings = results.findings.filter(f => f.type === 'entropy');
      expect(entropyFindings.length).toBeGreaterThanOrEqual(1);
      expect(entropyFindings[0].secret).toBe(secret);
    } finally {
      cleanDir(dir);
    }
  });

  test('shouldScanForEntropy skips UUIDs and path-like strings', () => {
    expect(scanner.shouldScanForEntropy('9f8b7c6d-1a2b-3c4d-5e6f-7a8b9c0d1e2f')).toBe(false);
    expect(scanner.shouldScanForEntropy('lib/node_modules/some-package/dist/index.js')).toBe(false);
    // Path-like but with a long random segment — still scannable
    expect(scanner.shouldScanForEntropy('api/v1/tr8xPqm2VbLw9ZkYd3RfCnJ0hG5sQxTe4uHiOp1A')).toBe(true);
  });
});
