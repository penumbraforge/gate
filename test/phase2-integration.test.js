/**
 * Phase 2 Integration Tests
 *
 * End-to-end tests that exercise the complete Phase 2 workflow:
 * creating temp repos with real secrets, scanning, fixing, and verifying.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { scanFiles, scanAll } = require('../src/cli/scanner');
const { fixAll, dryRun, undo } = require('../src/cli/fixer');
const { assessExposure } = require('../src/cli/exposure');
const { scanHistory, generatePurgeScript } = require('../src/cli/history');
const { generateSARIF, generateJSONReport } = require('../src/cli/reporter');

/**
 * Create a temporary directory initialised as a git repo.
 * Returns the absolute path to the directory.
 */
function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-int-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Clean up a temp directory, ignoring errors.
 */
function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('Phase 2 Integration', () => {

  test('full scan -> find -> fix -> re-scan -> clean', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');

      // Scan — should find the secret
      const results = scanFiles([file], { configDir: dir });
      expect(results.totalFindings).toBeGreaterThan(0);

      // Fix — should extract to .env
      const fixResult = fixAll(results, { repoDir: dir });
      expect(fixResult.fixed).toBeGreaterThan(0);

      // The source file should now reference process.env, not the raw secret
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain('process.env');
      expect(content).not.toContain('sk_live_00000000000000000000000000');

      // .env should have the secret
      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('sk_live_00000000000000000000000000');

      // .gitignore should contain .env
      const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.env');

      // .env.example should exist with placeholder
      expect(fs.existsSync(path.join(dir, '.env.example'))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test('gate fix --dry-run shows changes without modifying files', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');

      const results = scanFiles([file], { configDir: dir });
      const preview = dryRun(results, { repoDir: dir });

      // File should NOT be modified
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain('sk_live_00000000000000000000000000');

      // Preview should show what would be fixed (uses 'fixed' not 'wouldFix')
      expect(preview.fixed).toBeGreaterThan(0);
      expect(preview.changes.length).toBeGreaterThan(0);

      // Each change should have before/after
      const change = preview.changes[0];
      expect(change.before).toBeDefined();
      expect(change.after).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  test('gate fix -> gate fix --undo restores files', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      const original = 'const key = "sk_live_00000000000000000000000000";\n';
      fs.writeFileSync(file, original);

      const results = scanFiles([file], { configDir: dir });
      fixAll(results, { repoDir: dir });

      // Verify file was changed
      expect(fs.readFileSync(file, 'utf8')).not.toBe(original);

      // Undo — undo() takes the repoDir directly
      const undoResult = undo(dir);
      expect(undoResult.error).toBeNull();
      expect(undoResult.restored).toBeGreaterThan(0);

      // Verify file is restored
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    } finally {
      cleanup(dir);
    }
  });

  test('gate scan --history finds secrets in committed history', async () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');
      execSync('git add -A && git commit -m "add config"', { cwd: dir, stdio: 'ignore' });

      // Remove the secret
      fs.writeFileSync(file, 'const key = process.env.STRIPE_KEY;\n');
      execSync('git add -A && git commit -m "fix: remove secret"', { cwd: dir, stdio: 'ignore' });

      // scanHistory is async
      const results = await scanHistory(10, { cwd: dir });
      expect(results.commitsScanned).toBeGreaterThan(0);
      expect(results.findings.length).toBeGreaterThan(0);

      // Should detect a stripe-related finding
      const stripeFindings = results.findings.filter(f =>
        f.ruleId.includes('stripe')
      );
      expect(stripeFindings.length).toBeGreaterThan(0);
    } finally {
      cleanup(dir);
    }
  });

  test('gate purge generates valid script', async () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');
      execSync('git add -A && git commit -m "add config"', { cwd: dir, stdio: 'ignore' });

      // scanHistory and generatePurgeScript are both async
      const historyResults = await scanHistory(10, { cwd: dir });

      // generatePurgeScript uses options.cwd, not options.repoDir
      const purge = await generatePurgeScript(historyResults.findings, { cwd: dir });

      expect(purge.scriptPath).toBeTruthy();
      expect(fs.existsSync(purge.scriptPath)).toBe(true);

      const script = fs.readFileSync(purge.scriptPath, 'utf8');
      expect(script).toContain('git filter-repo');
      expect(script).toContain('REDACTED_BY_GATE');

      // Force-push should be commented out
      expect(script).toContain('# git push');

      expect(purge.secretCount).toBeGreaterThan(0);
      expect(purge.affectedFiles.length).toBeGreaterThan(0);
    } finally {
      cleanup(dir);
    }
  });

  test('SARIF output has correct structure', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');

      const results = scanFiles([file], { configDir: dir });
      const sarif = generateSARIF(results);

      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs).toHaveLength(1);
      expect(sarif.runs[0].tool.driver.name).toBe('Gate');
      expect(sarif.runs[0].results.length).toBeGreaterThan(0);

      // Check that results have locations with startLine
      const result = sarif.runs[0].results[0];
      expect(result.locations[0].physicalLocation.region.startLine).toBeDefined();
      expect(result.locations[0].physicalLocation.region.startColumn).toBeDefined();

      // Check ruleId is set
      expect(result.ruleId).toBeDefined();

      // Check that rules array is populated
      expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
    } finally {
      cleanup(dir);
    }
  });

  test('JSON output has all required fields', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');

      const results = scanFiles([file], { configDir: dir });
      const json = generateJSONReport(results);

      expect(json.version).toBeDefined();
      expect(json.timestamp).toBeDefined();
      expect(json.findings).toBeInstanceOf(Array);
      expect(json.summary).toBeDefined();
      expect(json.summary.totalFindings).toBeGreaterThan(0);
      expect(json.summary.filesScanned).toBe(1);

      // Each finding should have required fields
      const finding = json.findings[0];
      expect(finding.ruleId).toBeDefined();
      expect(finding.severity).toBeDefined();
      expect(finding.file).toBeDefined();
      expect(finding.remediation).toBeDefined();
      expect(finding.compliance).toBeDefined();
    } finally {
      cleanup(dir);
    }
  });

  test('exposure assessment detects LOCAL vs COMMITTED', async () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "secret";\n');

      // Staged but not committed -> LOCAL
      execSync('git add config.js', { cwd: dir, stdio: 'ignore' });
      // assessExposure is async
      const local = await assessExposure('config.js', dir);
      expect(local.level).toBe('LOCAL');
      expect(local.confidence).toBe('high');

      // Committed -> COMMITTED
      execSync('git commit -m "add config"', { cwd: dir, stdio: 'ignore' });
      const committed = await assessExposure('config.js', dir);
      expect(committed.level).toBe('COMMITTED');
      expect(['high', 'medium']).toContain(committed.confidence);
    } finally {
      cleanup(dir);
    }
  });

  test('fix handles multiple findings in the same file', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, [
        'const stripe = "sk_live_00000000000000000000000000";',
        'const aws = "AKIAIOSFODNN7EXAMPLE";',
        '',
      ].join('\n'));

      const results = scanFiles([file], { configDir: dir });
      expect(results.totalFindings).toBeGreaterThanOrEqual(2);

      const fixResult = fixAll(results, { repoDir: dir });
      expect(fixResult.fixed).toBeGreaterThanOrEqual(2);
      expect(fixResult.envEntries.length).toBeGreaterThanOrEqual(2);

      // .env should have both secrets
      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('sk_live_00000000000000000000000000');
      expect(envContent).toContain('AKIAIOSFODNN7EXAMPLE');
    } finally {
      cleanup(dir);
    }
  });

  test('fix creates .env.example with placeholders', () => {
    const dir = createTempRepo();
    try {
      const file = path.join(dir, 'config.js');
      fs.writeFileSync(file, 'const key = "sk_live_00000000000000000000000000";\n');

      const results = scanFiles([file], { configDir: dir });
      fixAll(results, { repoDir: dir });

      const example = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
      // Should have the var name but NOT the actual value
      expect(example).toContain('STRIPE_SECRET_KEY');
      expect(example).not.toContain('sk_live_00000000000000000000000000');
    } finally {
      cleanup(dir);
    }
  });

  test('self-scan: Gate scans itself with zero findings', () => {
    const gateCwd = path.resolve(__dirname, '..');
    const results = scanAll({ configDir: gateCwd });
    expect(results.totalFindings).toBe(0);
  });
});
