const fs = require('fs');
const path = require('path');
const os = require('os');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
}

describe('config', () => {
  let loadConfig;

  beforeEach(() => {
    jest.resetModules();
    loadConfig = require('../config').loadConfig;
  });

  test('returns smart defaults when no .gaterc exists', () => {
    const dir = createTempDir();
    const config = loadConfig(dir);
    expect(config.entropy_threshold).toBe(4.8);
    expect(config.verify).toBe(true);
    expect(config.hooks).toEqual(['pre-commit']);
    expect(config.output.format).toBe('text');
    expect(config.output.color).toBe('auto');
    expect(config.output.context_lines).toBe(2);
    expect(config.severity).toEqual({});
    expect(config.rules).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });

  test('loads and merges .gaterc YAML overrides', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), [
      'entropy_threshold: 4.2',
      'verify: false',
      'hooks:',
      '  - pre-commit',
      '  - pre-push',
      'severity:',
      '  sentry-dsn: ignore',
    ].join('\n'));
    const config = loadConfig(dir);
    expect(config.entropy_threshold).toBe(4.2);
    expect(config.verify).toBe(false);
    expect(config.hooks).toEqual(['pre-commit', 'pre-push']);
    expect(config.severity['sentry-dsn']).toBe('ignore');
    expect(config.output.format).toBe('text');
    fs.rmSync(dir, { recursive: true });
  });

  test('handles invalid YAML gracefully', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), '{{{{invalid yaml');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const config = loadConfig(dir);
    expect(config.entropy_threshold).toBe(4.8);
    consoleSpy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  test('reports specific error for invalid YAML', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), 'invalid: yaml: [\\nnot closed');

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const config = loadConfig(dir);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Invalid .gaterc/));
    consoleSpy.mockRestore();

    // Should still return defaults
    expect(config.entropy_threshold).toBe(4.8);

    fs.rmSync(dir, { recursive: true });
  });

  test('ignores unknown keys without crashing', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), 'future_feature: true\nentropy_threshold: 4.5');
    const config = loadConfig(dir);
    expect(config.entropy_threshold).toBe(4.5);
    fs.rmSync(dir, { recursive: true });
  });

  test('parses custom rules', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), [
      'rules:',
      '  - id: acme-key',
      '    name: "ACME API Key"',
      '    pattern: "acme_[a-z]{4}_[A-Za-z0-9]{40}"',
      '    severity: high',
      '    remediation: "Rotate at admin.acme.com"',
    ].join('\n'));
    const config = loadConfig(dir);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe('acme-key');
    expect(config.rules[0].severity).toBe('high');
    fs.rmSync(dir, { recursive: true });
  });

  test('handles malformed custom rule pattern', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), [
      'rules:',
      '  - id: bad-rule',
      '    name: "Bad Rule"',
      '    pattern: "[invalid(regex"',
      '    severity: high',
    ].join('\n'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const config = loadConfig(dir);
    expect(config.rules).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/bad-rule.*invalid regex/));
    consoleSpy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  test('warns on custom rule with invalid regex', () => {
    const tmpDir = createTempDir();
    fs.writeFileSync(path.join(tmpDir, '.gaterc'), JSON.stringify({
      rules: [
        { id: 'bad-rule', pattern: '[invalid(regex', severity: 'high' },
        { id: 'good-rule', pattern: 'MYSECRET_[A-Z0-9]{32}', severity: 'high' }
      ]
    }));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const config = loadConfig(tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/bad-rule.*invalid regex/));
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe('good-rule');

    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('warns on custom rule missing required fields', () => {
    const tmpDir = createTempDir();
    fs.writeFileSync(path.join(tmpDir, '.gaterc'), JSON.stringify({
      rules: [
        { pattern: 'SECRET_[A-Z]+', severity: 'high' },
        { id: 'no-pattern-rule', severity: 'high' }
      ]
    }));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const config = loadConfig(tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/missing 'id'/));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/missing 'pattern'/));
    expect(config.rules).toHaveLength(0);

    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('detectStack finds Node.js projects', () => {
    const { detectStack } = require('../config');
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    expect(detectStack(dir)).toContain('node');
    fs.rmSync(dir, { recursive: true });
  });

  test('detectStack finds Python projects', () => {
    const { detectStack } = require('../config');
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, 'requirements.txt'), '');
    expect(detectStack(dir)).toContain('python');
    fs.rmSync(dir, { recursive: true });
  });

  test('getDefaultIgnorePatterns returns stack-appropriate patterns', () => {
    const { getDefaultIgnorePatterns } = require('../config');
    const patterns = getDefaultIgnorePatterns(['node']);
    expect(patterns).toContain('node_modules/**');
    expect(patterns).toContain('.git/**');
  });

  test('loadConfig includes max_file_size with default', () => {
    const dir = createTempDir();
    const config = loadConfig(dir);
    expect(config.max_file_size).toBe(2 * 1024 * 1024);
    fs.rmSync(dir, { recursive: true });
  });

  test('loadConfig parses max_file_size from .gaterc', () => {
    const dir = createTempDir();
    fs.writeFileSync(path.join(dir, '.gaterc'), 'max_file_size: 5MB\n');
    const config = loadConfig(dir);
    expect(config.max_file_size).toBe(5 * 1024 * 1024);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('parseFileSize', () => {
  let parseFileSize, DEFAULT_MAX_FILE_SIZE;

  beforeEach(() => {
    jest.resetModules();
    const config = require('../config');
    parseFileSize = config.parseFileSize;
    DEFAULT_MAX_FILE_SIZE = config.DEFAULT_MAX_FILE_SIZE;
  });

  test('passes through numeric values', () => {
    expect(parseFileSize(2048)).toBe(2048);
    expect(parseFileSize(1)).toBe(1);
    expect(parseFileSize(10485760)).toBe(10485760);
  });

  test('parses string numbers as bytes', () => {
    expect(parseFileSize('2048')).toBe(2048);
    expect(parseFileSize('1000000')).toBe(1000000);
  });

  test('parses KB/K units (case-insensitive)', () => {
    expect(parseFileSize('100KB')).toBe(100 * 1024);
    expect(parseFileSize('100kb')).toBe(100 * 1024);
    expect(parseFileSize('100K')).toBe(100 * 1024);
    expect(parseFileSize('100k')).toBe(100 * 1024);
  });

  test('parses MB/M units (case-insensitive)', () => {
    expect(parseFileSize('5MB')).toBe(5 * 1024 * 1024);
    expect(parseFileSize('5mb')).toBe(5 * 1024 * 1024);
    expect(parseFileSize('5M')).toBe(5 * 1024 * 1024);
    expect(parseFileSize('5m')).toBe(5 * 1024 * 1024);
  });

  test('parses GB/G units (case-insensitive)', () => {
    expect(parseFileSize('1GB')).toBe(1024 * 1024 * 1024);
    expect(parseFileSize('1gb')).toBe(1024 * 1024 * 1024);
    expect(parseFileSize('1G')).toBe(1024 * 1024 * 1024);
  });

  test('returns default for invalid input', () => {
    expect(parseFileSize(null)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize(undefined)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize('abc')).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize('')).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize({})).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize(-100)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize(NaN)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parseFileSize(Infinity)).toBe(DEFAULT_MAX_FILE_SIZE);
  });

  test('handles decimal values', () => {
    expect(parseFileSize('1.5MB')).toBe(Math.round(1.5 * 1024 * 1024));
    expect(parseFileSize('0.5GB')).toBe(Math.round(0.5 * 1024 * 1024 * 1024));
  });
});
