/**
 * Tests for src/cli/interactive.js
 *
 * Mocks stdin keypresses and dependencies (fixer, vault, exposure).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// ─── Module-level mocks (variable names must start with "mock" per Jest) ────

const mockFixer = { fixFinding: jest.fn() };
const mockVault = { encrypt: jest.fn() };
const mockExposure = { assessExposure: jest.fn(), formatExposure: jest.fn() };
const mockRemediation = { getRemediation: jest.fn(), getActionLabel: jest.fn() };

jest.mock('../fixer', () => mockFixer);
jest.mock('../vault', () => mockVault);
jest.mock('../exposure', () => mockExposure);
jest.mock('../remediation', () => mockRemediation);

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFinding(overrides = {}) {
  return {
    ruleId: 'stripe-live-secret',
    ruleName: 'Stripe Live Secret',
    severity: 'critical',
    file: '/fake/project/config.js',
    lineNumber: 5,
    match: 'sk_live_abc123',
    matchStart: 10,
    matchLength: 14,
    remediation: 'Move to env var',
    ...overrides,
  };
}

// Build a mock TTY stdin that lets us simulate keypresses.
function makeMockStdin() {
  const emitter = new EventEmitter();
  emitter.isTTY = true;
  emitter.setRawMode = jest.fn();
  emitter.resume = jest.fn();
  emitter.pause = jest.fn();
  emitter.setEncoding = jest.fn();
  return emitter;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let mockStdin;
let originalStdin;

beforeEach(() => {
  jest.resetModules();

  mockFixer.fixFinding.mockReset();
  mockVault.encrypt.mockReset();
  mockExposure.assessExposure.mockReset();
  mockExposure.formatExposure.mockReset();
  mockRemediation.getRemediation.mockReset();
  mockRemediation.getActionLabel.mockReset();

  // Default: LOCAL exposure.
  mockExposure.assessExposure.mockResolvedValue({
    level: 'LOCAL',
    confidence: 'high',
    details: 'File is staged but has never been committed.',
  });
  mockExposure.formatExposure.mockReturnValue('LOCAL ONLY');

  // Default remediation.
  mockRemediation.getRemediation.mockReturnValue({
    action: 'rotate',
    guide: 'Rotate this key immediately.',
    link: 'https://example.com',
  });
  mockRemediation.getActionLabel.mockReturnValue('ROTATE');

  // Default fixer: success.
  mockFixer.fixFinding.mockReturnValue({
    fixed: true,
    envEntry: { varName: 'STRIPE_SECRET_KEY', value: 'sk_live_abc123' },
    note: null,
    warning: null,
    change: null,
  });

  // Replace process.stdin with a mock TTY stream.
  mockStdin = makeMockStdin();
  originalStdin = process.stdin;
  Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
});

// ─── Test 1: promptHookAction returns 'f' ────────────────────────────────────

test('1. promptHookAction returns f when f is pressed', async () => {
  const { promptHookAction } = require('../interactive');

  setImmediate(() => mockStdin.emit('data', 'f'));
  const result = await promptHookAction(false);
  expect(result).toBe('f');
});

// ─── Test 2: promptHookAction returns 'a' ────────────────────────────────────

test('2. promptHookAction returns a when a is pressed', async () => {
  const { promptHookAction } = require('../interactive');

  setImmediate(() => mockStdin.emit('data', 'a'));
  const result = await promptHookAction(false);
  expect(result).toBe('a');
});

// ─── Test 3: promptChoice returns null for non-TTY stdin ────────────────────

test('3. promptChoice returns null for non-TTY stdin', async () => {
  mockStdin.isTTY = false;
  const { promptChoice } = require('../interactive');

  const result = await promptChoice(['f', 'i', 'a'], () => {});
  expect(result).toBeNull();
});

// ─── Test 4: runInteractive LOCAL — shows fix/vault/ignore/skip/explain ──────

test('4. runInteractive with LOCAL finding shows correct options', async () => {
  const { runInteractive } = require('../interactive');

  const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  // Skip the finding.
  setImmediate(() => mockStdin.emit('data', 's'));

  const findings = [makeFinding()];
  await runInteractive(findings, { color: false, repoDir: '/fake/project' });

  const allOutput = [...writeSpy.mock.calls, ...logSpy.mock.calls]
    .map(args => args.join(' '))
    .join('\n');

  // LOCAL options should be present.
  expect(allOutput).toMatch(/\[f\]/i);  // Fix
  expect(allOutput).toMatch(/\[v\]/i);  // Vault
  expect(allOutput).toMatch(/\[i\]/i);  // Ignore
  expect(allOutput).toMatch(/\[s\]/i);  // Skip
  expect(allOutput).toMatch(/\[\?]/);   // Explain

  writeSpy.mockRestore();
  logSpy.mockRestore();
});

// ─── Test 5: runInteractive PUSHED — shows respond/fix/skip/explain ──────────

test('5. runInteractive with PUSHED finding shows respond/fix/skip/explain (no vault/ignore)', async () => {
  mockExposure.assessExposure.mockResolvedValue({
    level: 'PUSHED',
    confidence: 'high',
    details: 'File exists in remote-tracking refs.',
  });
  mockExposure.formatExposure.mockReturnValue('COMPROMISED');

  const { runInteractive } = require('../interactive');

  const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  setImmediate(() => mockStdin.emit('data', 's'));

  const findings = [makeFinding()];
  await runInteractive(findings, { color: false, repoDir: '/fake/project' });

  const allOutput = [...writeSpy.mock.calls, ...logSpy.mock.calls]
    .map(args => args.join(' '))
    .join('\n');

  // PUSHED options.
  expect(allOutput).toMatch(/\[r\]/i);  // Respond
  expect(allOutput).toMatch(/\[f\]/i);  // Fix code
  expect(allOutput).toMatch(/\[s\]/i);  // Skip
  expect(allOutput).toMatch(/\[\?]/);   // Explain

  // Vault and Ignore should NOT appear for PUSHED.
  // Check that [v] does not show as an option (vault).
  // We check the options block specifically rather than all output.
  expect(allOutput).not.toMatch(/\[v\].*Vault/i);
  expect(allOutput).not.toMatch(/\[i\].*Ignore/i);

  writeSpy.mockRestore();
  logSpy.mockRestore();
});

// ─── Test 6: runInteractive fix action calls fixer.fixFinding ────────────────

test('6. runInteractive fix action calls fixer.fixFinding', async () => {
  const { runInteractive } = require('../interactive');

  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(console, 'log').mockImplementation(() => {});

  setImmediate(() => mockStdin.emit('data', 'f'));

  const finding = makeFinding();
  await runInteractive([finding], { color: false, repoDir: '/fake/project' });

  expect(mockFixer.fixFinding).toHaveBeenCalledWith(
    finding,
    finding.file,
    expect.objectContaining({ repoDir: '/fake/project' })
  );

  process.stdout.write.mockRestore();
  console.log.mockRestore();
});

// ─── Test 7: runInteractive ignore action adds to .gateignore ────────────────

test('7. runInteractive ignore action adds rule+file to .gateignore', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-interactive-test-'));

  try {
    const finding = makeFinding({ file: path.join(tmpDir, 'config.js') });

    fs.writeFileSync(finding.file, 'const key = "sk_live_abc123";\n');

    mockExposure.assessExposure.mockResolvedValue({ level: 'LOCAL', confidence: 'high', details: '' });

    const { runInteractive } = require('../interactive');

    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    setImmediate(() => mockStdin.emit('data', 'i'));

    await runInteractive([finding], { color: false, repoDir: tmpDir });

    process.stdout.write.mockRestore();
    console.log.mockRestore();

    const ignorePath = path.join(tmpDir, '.gateignore');
    expect(fs.existsSync(ignorePath)).toBe(true);
    const content = fs.readFileSync(ignorePath, 'utf8');
    expect(content).toContain('stripe-live-secret');
    expect(content).toContain('config.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Test 8: runInteractive skip moves to next finding ───────────────────────

test('8. runInteractive skip moves to next finding without acting', async () => {
  const { runInteractive } = require('../interactive');

  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(console, 'log').mockImplementation(() => {});

  setImmediate(() => {
    mockStdin.emit('data', 's');
    setImmediate(() => mockStdin.emit('data', 's'));
  });

  const findings = [makeFinding(), makeFinding({ file: '/fake/project/other.js' })];
  await runInteractive(findings, { color: false, repoDir: '/fake/project' });

  expect(mockFixer.fixFinding).not.toHaveBeenCalled();

  process.stdout.write.mockRestore();
  console.log.mockRestore();
});

// ─── Test 9: runInteractive explain shows remediation guide ──────────────────

test('9. runInteractive explain shows remediation guide', async () => {
  const { runInteractive } = require('../interactive');

  const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  // '?' to explain, then 's' to skip.
  setImmediate(() => {
    mockStdin.emit('data', '?');
    setImmediate(() => mockStdin.emit('data', 's'));
  });

  const findings = [makeFinding()];
  await runInteractive(findings, { color: false, repoDir: '/fake/project' });

  const allOutput = [...writeSpy.mock.calls, ...logSpy.mock.calls]
    .map(args => args.join(' '))
    .join('\n');

  expect(mockRemediation.getRemediation).toHaveBeenCalledWith('stripe-live-secret');
  expect(allOutput).toMatch(/Rotate this key immediately/i);

  writeSpy.mockRestore();
  logSpy.mockRestore();
});

// ─── Test 10: Multiple findings walks through each one ───────────────────────

test('10. Multiple findings walks through each one', async () => {
  const { runInteractive } = require('../interactive');

  const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  const findings = [
    makeFinding({ file: '/fake/project/a.js' }),
    makeFinding({ file: '/fake/project/b.js', ruleId: 'github-pat', ruleName: 'GitHub PAT' }),
    makeFinding({ file: '/fake/project/c.js', ruleId: 'openai-api-key', ruleName: 'OpenAI API Key' }),
  ];

  // 'f' for first, 's' for second, 's' for third.
  setImmediate(() => {
    mockStdin.emit('data', 'f');
    setImmediate(() => {
      mockStdin.emit('data', 's');
      setImmediate(() => mockStdin.emit('data', 's'));
    });
  });

  await runInteractive(findings, { color: false, repoDir: '/fake/project' });

  expect(mockFixer.fixFinding).toHaveBeenCalledTimes(1);
  expect(mockFixer.fixFinding).toHaveBeenCalledWith(
    findings[0],
    findings[0].file,
    expect.any(Object)
  );

  const allOutput = [...writeSpy.mock.calls, ...logSpy.mock.calls]
    .map(args => args.join(' '))
    .join('\n');
  expect(allOutput).toMatch(/1.*fixed|fixed.*1/i);

  writeSpy.mockRestore();
  logSpy.mockRestore();
});
