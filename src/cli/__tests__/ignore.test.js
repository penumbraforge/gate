const fs = require('fs');
const path = require('path');
const os = require('os');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
}

describe('ignore', () => {
  let loadIgnorePatterns, shouldIgnoreFile, shouldIgnoreFinding, hasInlineIgnore;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../ignore');
    loadIgnorePatterns = mod.loadIgnorePatterns;
    shouldIgnoreFile = mod.shouldIgnoreFile;
    shouldIgnoreFinding = mod.shouldIgnoreFinding;
    hasInlineIgnore = mod.hasInlineIgnore;
  });

  test('returns empty patterns when no .gateignore exists', () => {
    const dir = createTempDir();
    const patterns = loadIgnorePatterns(dir);
    expect(patterns.filePatterns).toEqual([]);
    expect(patterns.rulePatterns).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });

  test('parses file glob patterns', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gateignore'), 'test/fixtures/**\n*.min.js\n');
    const patterns = loadIgnorePatterns(dir);
    expect(patterns.filePatterns).toHaveLength(2);
    fs.rmSync(dir, { recursive: true });
  });

  test('parses rule-specific patterns with bracket syntax', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gateignore'),
      '[rule:high-entropy-string] src/crypto/**\n[rule:aws-account-id] docs/**\n');
    const patterns = loadIgnorePatterns(dir);
    expect(patterns.rulePatterns).toHaveLength(2);
    expect(patterns.rulePatterns[0].ruleId).toBe('high-entropy-string');
    expect(patterns.rulePatterns[0].glob).toBe('src/crypto/**');
    fs.rmSync(dir, { recursive: true });
  });

  test('skips comments and blank lines', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gateignore'), '# comment\n\ntest/**\n  \n');
    const patterns = loadIgnorePatterns(dir);
    expect(patterns.filePatterns).toHaveLength(1);
    fs.rmSync(dir, { recursive: true });
  });

  test('shouldIgnoreFile matches glob patterns', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gateignore'), 'test/fixtures/**\n*.min.js');
    const patterns = loadIgnorePatterns(dir);
    expect(shouldIgnoreFile('test/fixtures/aws.js', patterns)).toBe(true);
    expect(shouldIgnoreFile('src/config.js', patterns)).toBe(false);
    expect(shouldIgnoreFile('bundle.min.js', patterns)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  test('shouldIgnoreFinding checks rule-specific patterns', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gateignore'),
      '[rule:high-entropy-string] src/crypto/**');
    const patterns = loadIgnorePatterns(dir);
    expect(shouldIgnoreFinding('high-entropy-string', 'src/crypto/hash.js', patterns)).toBe(true);
    expect(shouldIgnoreFinding('high-entropy-string', 'src/config.js', patterns)).toBe(false);
    expect(shouldIgnoreFinding('aws-access-key-id', 'src/crypto/hash.js', patterns)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  test('hasInlineIgnore detects gate-ignore comment', () => {
    expect(hasInlineIgnore('const x = "secret"; // gate-ignore')).toBe(true);
    expect(hasInlineIgnore('const x = "secret"; // gate-ignore: test fixture')).toBe(true);
    expect(hasInlineIgnore('const x = "secret";')).toBe(false);
    expect(hasInlineIgnore('// gate-ignore')).toBe(true);
    expect(hasInlineIgnore('const x = "secret"; /* gate-ignore */')).toBe(true);
  });

  test('getIgnoreReason extracts reason', () => {
    const mod = require('../ignore');
    expect(mod.getIgnoreReason('const x = "s"; // gate-ignore: test fixture')).toBe('test fixture');
    expect(mod.getIgnoreReason('const x = "s"; // gate-ignore')).toBe(null);
  });
});
