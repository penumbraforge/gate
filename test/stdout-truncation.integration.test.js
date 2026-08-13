'use strict';

/**
 * Regression test: `gate scan --format json|sarif` output larger than the
 * 64 KiB pipe buffer must not be truncated. process.exit() right after
 * console.log() discards the unflushed tail when stdout is a pipe.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const GATE_BIN = path.join(__dirname, '..', 'bin', 'gate.js');

const FILE_COUNT = 8;
const KEYS_PER_FILE = 100;

function base36(n, width) {
  return n.toString(36).toUpperCase().padStart(width, '0');
}

function createLargeFixtureDir() {
  // Deliberately NOT a git repo — exercises the direct file-scan path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-trunc-test-'));
  let serial = 0;
  for (let f = 0; f < FILE_COUNT; f++) {
    const lines = [];
    for (let k = 0; k < KEYS_PER_FILE; k++) {
      // Unique fake AWS access key IDs: AKIA + 16 chars
      const key = `AKIA${base36(serial++, 10)}ABCDEF`;
      lines.push(`const key${k} = "${key}";`);
    }
    fs.writeFileSync(path.join(dir, `planted-${f}.js`), lines.join('\n') + '\n');
  }
  return dir;
}

function runGateScan(dir, format) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [GATE_BIN, 'scan', '.', '--format', format, '--no-verify'],
      {
        cwd: dir,
        // stdout MUST be a pipe (not inherited) to reproduce the truncation
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', GATE_OFFLINE: '1' },
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('large scan output is not truncated at 64 KiB', () => {
  let dir;

  beforeAll(() => {
    dir = createLargeFixtureDir();
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('--format json: full payload arrives through a pipe and parses', async () => {
    const result = await runGateScan(dir, 'json');

    expect(result.stdout.length).toBeGreaterThan(65536);
    const parsed = JSON.parse(result.stdout); // throws if truncated
    expect(parsed.findings.length).toBe(FILE_COUNT * KEYS_PER_FILE);
    expect(result.code).toBe(1);
  }, 60000);

  test('--format sarif: full payload arrives through a pipe and parses', async () => {
    const result = await runGateScan(dir, 'sarif');

    expect(result.stdout.length).toBeGreaterThan(65536);
    const parsed = JSON.parse(result.stdout); // throws if truncated
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].results.length).toBe(FILE_COUNT * KEYS_PER_FILE);
    expect(result.code).toBe(1);
  }, 60000);
});
