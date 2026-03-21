/**
 * Tests for git history scanner and purge script generator
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-history-test-'));
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Initialize a git repo with user identity configured (needed for commits)
 */
function gitInit(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
}

/**
 * Commit a file with a given name and content, optionally with a backdated author date.
 * Returns the commit hash.
 */
function commitFile(dir, filename, content, message = 'test commit', envOverrides = {}) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  execSync(`git add "${filename}"`, { cwd: dir, stdio: 'ignore' });
  const env = { ...process.env, ...envOverrides };
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'ignore', env });
  const hash = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
  return hash;
}

let history;

beforeEach(() => {
  jest.resetModules();
  history = require('../history');
});

// ─── Test 1: Finds secret in committed history ───────────────────────────────
test('1. finds secret in committed history', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);
    commitFile(dir, 'config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'add payment config');

    const result = await history.scanHistory(50, { cwd: dir });

    expect(result.commitsScanned).toBeGreaterThanOrEqual(1);
    const found = result.findings.some(f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE'));
    expect(found).toBe(true);

    // Verify finding shape
    const finding = result.findings.find(f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE'));
    expect(finding).toBeDefined();
    expect(finding.commitHash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(finding.commitDate).toBeDefined();
    expect(finding.author).toBeDefined();
    expect(finding.subject).toBe('add payment config');
    expect(finding.file).toContain('config.js');
    expect(typeof finding.lineNumber).toBe('number');
    expect(finding.ruleId).toBeDefined();
    expect(finding.ruleName).toBeDefined();
    expect(finding.severity).toBeDefined();
    expect(typeof finding.daysInHistory).toBe('number');
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 2: Respects commit count limit ─────────────────────────────────────
test('2. respects commit count limit — scans only last N commits', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);

    // Commit 5 times — only commit 4 and 5 should be scanned with limit=2
    commitFile(dir, 'old1.txt', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'old commit 1');
    commitFile(dir, 'old2.txt', 'hello world\n', 'old commit 2');
    commitFile(dir, 'old3.txt', 'foo bar\n', 'old commit 3');
    commitFile(dir, 'recent1.txt', 'no secret here\n', 'recent commit 4');
    commitFile(dir, 'recent2.txt', 'also clean\n', 'recent commit 5');

    const result = await history.scanHistory(2, { cwd: dir });

    expect(result.commitsScanned).toBe(2);
    // Secret was in commit 1 which should NOT be scanned
    const awsFindings = result.findings.filter(
      f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE')
    );
    expect(awsFindings).toHaveLength(0);
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 3: Only scans added lines, not removed ──────────────────────────────
test('3. only scans added lines — does not flag removed secrets', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);

    // Commit 1: add file with secret
    commitFile(dir, 'config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'add secret');

    // Commit 2: remove the secret (replace with env var)
    fs.writeFileSync(path.join(dir, 'config.js'), 'const key = process.env.API_KEY;\n');
    execSync('git add config.js', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "remove secret"', { cwd: dir, stdio: 'ignore' });

    // Scan only the last 1 commit — this commit removes the secret, adds env var
    const result = await history.scanHistory(1, { cwd: dir });

    expect(result.commitsScanned).toBe(1);
    // The removal commit added no secrets
    const awsFindings = result.findings.filter(
      f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE')
    );
    expect(awsFindings).toHaveLength(0);

    // Scan all commits — should find the secret in commit 1
    const allResult = await history.scanHistory(50, { cwd: dir });
    const allAwsFindings = allResult.findings.filter(
      f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE')
    );
    expect(allAwsFindings.length).toBeGreaterThanOrEqual(1);
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 4: Handles first commit (no parent) ────────────────────────────────
test('4. handles first commit with no parent', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);
    commitFile(dir, 'secret.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'initial commit');

    const result = await history.scanHistory(50, { cwd: dir });

    expect(result.commitsScanned).toBe(1);
    const found = result.findings.some(f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE'));
    expect(found).toBe(true);
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 5: Skips binary file diffs ─────────────────────────────────────────
test('5. skips binary diffs — no crash, no findings for binary files', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);

    // Write a binary file (PNG-like header bytes)
    const binaryData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x01, 0x00, 0x01,
    ]);
    fs.writeFileSync(path.join(dir, 'image.png'), binaryData);
    execSync('git add image.png', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add binary file"', { cwd: dir, stdio: 'ignore' });

    // Should not throw
    let result;
    expect(async () => {
      result = await history.scanHistory(50, { cwd: dir });
    }).not.toThrow();

    result = await history.scanHistory(50, { cwd: dir });
    expect(result.commitsScanned).toBeGreaterThanOrEqual(1);
    // No findings for binary files
    expect(result.findings).toHaveLength(0);
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 6: Calculates daysInHistory correctly ───────────────────────────────
test('6. calculates daysInHistory approximately correctly', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);

    // Backdate the commit by ~10 days using GIT_AUTHOR_DATE and GIT_COMMITTER_DATE
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    commitFile(
      dir,
      'config.js',
      'const key = "AKIAIOSFODNN7EXAMPLE";\n',
      'old commit',
      {
        GIT_AUTHOR_DATE: tenDaysAgo,
        GIT_COMMITTER_DATE: tenDaysAgo,
      }
    );

    const result = await history.scanHistory(50, { cwd: dir });
    const finding = result.findings.find(f => f.match && f.match.includes('AKIAIOSFODNN7EXAMPLE'));

    expect(finding).toBeDefined();
    // Allow ±2 days tolerance
    expect(finding.daysInHistory).toBeGreaterThanOrEqual(8);
    expect(finding.daysInHistory).toBeLessThanOrEqual(12);
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 7: generatePurgeScript includes git-filter-repo command ─────────────
test('7. generatePurgeScript includes git-filter-repo replacement command', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);
    commitFile(dir, 'config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'add secret');

    const result = await history.scanHistory(50, { cwd: dir });
    expect(result.findings.length).toBeGreaterThan(0);

    const purgeResult = await history.generatePurgeScript(result.findings, { cwd: dir });

    expect(purgeResult.scriptPath).toBeDefined();
    expect(purgeResult.secretCount).toBeGreaterThan(0);
    expect(purgeResult.affectedFiles).toBeDefined();
    expect(Array.isArray(purgeResult.affectedFiles)).toBe(true);

    const scriptContent = fs.readFileSync(purgeResult.scriptPath, 'utf8');
    expect(scriptContent).toContain('git-filter-repo');
    expect(scriptContent).toContain('REDACTED_BY_GATE');
    // Script no longer contains raw secrets — they are in the replacements file
    expect(scriptContent).toContain('replace-text');

    // Verify replacements file exists and contains the secret
    expect(purgeResult.replacementsPath).toBeDefined();
    const replacementsContent = fs.readFileSync(purgeResult.replacementsPath, 'utf8');
    expect(replacementsContent).toContain('AKIAIOSFODNN7EXAMPLE');
    expect(replacementsContent).toContain('REDACTED_BY_GATE');
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 8: generatePurgeScript does NOT auto-execute force-push ─────────────
test('8. generatePurgeScript does not auto-execute — force-push is commented out', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);
    commitFile(dir, 'config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'add secret');

    const result = await history.scanHistory(50, { cwd: dir });
    const purgeResult = await history.generatePurgeScript(result.findings, { cwd: dir });

    const scriptContent = fs.readFileSync(purgeResult.scriptPath, 'utf8');

    // Force-push lines must be commented out
    const lines = scriptContent.split('\n');
    const forcePushLines = lines.filter(
      l => l.includes('git push --force') && !l.trim().startsWith('#')
    );
    expect(forcePushLines).toHaveLength(0);

    // The commented-out version should still appear
    expect(scriptContent).toContain('# git push --force');
  } finally {
    cleanDir(dir);
  }
});

// ─── Test 9: Handles repos with no history ───────────────────────────────────
test('9. handles repos with no history — returns graceful empty result', async () => {
  const dir = createTempDir();
  try {
    gitInit(dir);
    // No commits — empty repo

    const result = await history.scanHistory(50, { cwd: dir });

    expect(result).toBeDefined();
    expect(result.commitsScanned).toBe(0);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.findings).toHaveLength(0);
  } finally {
    cleanDir(dir);
  }
});
