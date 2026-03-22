const { globToRegex } = require('../ignore');

describe('globToRegex', () => {
  function matches(glob, path) {
    return globToRegex(glob).test(path);
  }

  // Single star
  test('* matches files in current dir only', () => {
    expect(matches('*.js', 'foo.js')).toBe(true);
    expect(matches('*.js', 'src/foo.js')).toBe(false);
  });

  // Double star with path
  test('**/*.js matches at any depth', () => {
    expect(matches('**/*.js', 'foo.js')).toBe(true);
    expect(matches('**/*.js', 'src/foo.js')).toBe(true);
    expect(matches('**/*.js', 'a/b/c/foo.js')).toBe(true);
    expect(matches('**/*.js', 'foo.ts')).toBe(false);
  });

  // Double star at end
  test('src/** matches everything under src', () => {
    expect(matches('src/**', 'src/a')).toBe(true);
    expect(matches('src/**', 'src/a/b/c')).toBe(true);
    expect(matches('src/**', 'other/a')).toBe(false);
  });

  // Double star in middle
  test('**/test/** matches paths containing test dir', () => {
    expect(matches('**/test/**', 'test/a')).toBe(true);
    expect(matches('**/test/**', 'src/test/a')).toBe(true);
    expect(matches('**/test/**', 'src/test/a/b')).toBe(true);
  });

  // Brace expansion
  test('{a,b} expands alternatives', () => {
    expect(matches('*.{js,ts}', 'foo.js')).toBe(true);
    expect(matches('*.{js,ts}', 'foo.ts')).toBe(true);
    expect(matches('*.{js,ts}', 'foo.py')).toBe(false);
  });

  // Question mark
  test('? matches single non-separator character', () => {
    expect(matches('file?.js', 'file1.js')).toBe(true);
    expect(matches('file?.js', 'file12.js')).toBe(false);
    expect(matches('file?.js', 'file/.js')).toBe(false);
  });

  // Dot escaping
  test('dots are literal', () => {
    expect(matches('*.js', 'fooXjs')).toBe(false);
  });

  // Literal brackets
  test('brackets are literal (not character classes)', () => {
    expect(matches('[test]', '[test]')).toBe(true);
    expect(matches('[test]', 't')).toBe(false);
  });

  // Directory trailing slash
  test('trailing slash matches directory-like paths', () => {
    const re = globToRegex('dir/');
    expect(re.test('dir')).toBe(true);
    expect(re.test('dir/sub')).toBe(true);
  });

  // Complex patterns
  test('file.*.js matches file.test.js', () => {
    expect(matches('file.*.js', 'file.test.js')).toBe(true);
    expect(matches('file.*.js', 'file.spec.js')).toBe(true);
  });

  // Regex special chars
  test('special regex chars are escaped', () => {
    expect(matches('foo+bar.js', 'foo+bar.js')).toBe(true);
    expect(matches('foo(1).js', 'foo(1).js')).toBe(true);
    expect(matches('file$.txt', 'file$.txt')).toBe(true);
  });

  // Double star alone
  test('** alone matches everything', () => {
    expect(matches('**', 'anything')).toBe(true);
    expect(matches('**', 'a/b/c')).toBe(true);
  });

  // Real-world .gateignore patterns
  test('node_modules/** matches deeply nested', () => {
    expect(matches('node_modules/**', 'node_modules/express/index.js')).toBe(true);
  });

  test('src/cli/__tests__/** matches test files', () => {
    expect(matches('src/cli/__tests__/**', 'src/cli/__tests__/scanner.test.js')).toBe(true);
  });
});

describe('negation patterns', () => {
  const { loadIgnorePatterns, shouldIgnoreFile } = require('../ignore');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  test('! pattern un-ignores a file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    fs.writeFileSync(path.join(tmpDir, '.gateignore'), '*.log\n!important.log\n');

    const patterns = loadIgnorePatterns(tmpDir);
    expect(shouldIgnoreFile('debug.log', patterns)).toBe(true);
    expect(shouldIgnoreFile('important.log', patterns)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
