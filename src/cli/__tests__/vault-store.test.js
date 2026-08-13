/**
 * Tests for the vault store: persisted ciphertexts addressable by VAULT:<id>
 * references, and the interactive vault action's full round-trip.
 *
 * Regression: the interactive vault action used to write
 * VAULT:<first-20-chars-of-ciphertext> into source — truncated ciphertext,
 * secret irrecoverable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-vault-store-test-'));
}

function makeMockStdin() {
  const emitter = new EventEmitter();
  emitter.isTTY = true;
  emitter.setRawMode = jest.fn();
  emitter.resume = jest.fn();
  emitter.pause = jest.fn();
  emitter.setEncoding = jest.fn();
  return emitter;
}

beforeEach(() => {
  jest.resetModules();
});

describe('vault.store / vault.retrieve', () => {
  test('round-trips a plaintext through ~/.gate/vault.json', () => {
    const vault = require('../vault');
    const { getGatePath } = require('../paths');

    const entry = vault.store('my-super-secret-value');

    // id is the first 12 hex chars of sha256(ciphertext)
    expect(entry.id).toMatch(/^[0-9a-f]{12}$/);
    expect(typeof entry.ciphertext).toBe('string');
    expect(entry.createdAt).toBeTruthy();

    // Persisted to the gate home with owner-only permissions
    const storePath = getGatePath('vault.json');
    expect(fs.existsSync(storePath)).toBe(true);
    expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(persisted.some(e => e.id === entry.id)).toBe(true);
    // Plaintext never touches disk
    expect(fs.readFileSync(storePath, 'utf8')).not.toContain('my-super-secret-value');

    expect(vault.retrieve(entry.id)).toBe('my-super-secret-value');
  });

  test('store accumulates multiple entries and retrieve finds each', () => {
    const vault = require('../vault');

    const a = vault.store('first-secret-aaaa');
    const b = vault.store('second-secret-bbbb');

    expect(vault.retrieve(a.id)).toBe('first-secret-aaaa');
    expect(vault.retrieve(b.id)).toBe('second-secret-bbbb');
  });

  test('retrieve throws a clear error for unknown ids', () => {
    const vault = require('../vault');
    expect(() => vault.retrieve('000000000000')).toThrow(/not found/i);
  });
});

describe('interactive vault action round-trip (no mocks)', () => {
  let mockStdin;
  let originalStdin;

  beforeEach(() => {
    mockStdin = makeMockStdin();
    originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  });

  test('[v] writes VAULT:<id> into source and retrieve(id) recovers the secret', async () => {
    const dir = createTempDir();
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let keypressInterval;
    try {
      const secret = 'hunter2secretvalue';
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, `const password = "${secret}";\n`);

      const scanner = require('../scanner');
      const vault = require('../vault');
      const { runInteractive } = require('../interactive');

      const scanResults = scanner.scanFiles([filePath], { configDir: dir });
      const findings = scanResults.filesScanned
        .flatMap(f => f.findings.map(fi => ({ ...fi, file: f.file })));
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const finding = findings.find(f => f.ruleId === 'password-assignment');
      expect(finding).toBeDefined();

      // Keep pressing 'v' until the prompt consumes it (exposure assessment
      // runs real git subprocesses before the menu appears).
      keypressInterval = setInterval(() => mockStdin.emit('data', 'v'), 10);

      const result = await runInteractive([finding], { color: false, repoDir: dir });
      clearInterval(keypressInterval);
      keypressInterval = null;

      expect(result.summary.vaulted).toBe(1);

      // The source now carries only the short id — never truncated ciphertext
      const rewritten = fs.readFileSync(filePath, 'utf8');
      expect(rewritten).not.toContain(secret);
      const refMatch = rewritten.match(/VAULT:([0-9a-f]{12})\b/);
      expect(refMatch).not.toBeNull();

      // Full round-trip: the id recovers the original secret
      expect(vault.retrieve(refMatch[1])).toBe(secret);
    } finally {
      if (keypressInterval) clearInterval(keypressInterval);
      writeSpy.mockRestore();
      logSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
