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
    const config = loadConfig(dir);
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
    const config = loadConfig(dir);
    expect(config.rules).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
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
});
