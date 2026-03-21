/**
 * Tests for src/cli/exposure.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-exposure-test-'));
}

function gitInit(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir, message) {
  execSync(`git commit -m "${message}" --allow-empty`, { cwd: dir, stdio: 'ignore' });
}

let assessExposure, formatExposure;

beforeAll(() => {
  ({ assessExposure, formatExposure } = require('../exposure'));
});

// ---------------------------------------------------------------------------
// assessExposure tests
// ---------------------------------------------------------------------------

describe('assessExposure', () => {
  test('LOCAL — new staged file (never committed)', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);
      // Create initial commit so HEAD exists
      execSync('git commit -m "initial" --allow-empty', { cwd: dir, stdio: 'ignore' });

      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');
      execSync('git add secret.env', { cwd: dir, stdio: 'ignore' });

      const result = await assessExposure(filePath, dir);

      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('details');
      expect(result.level).toBe('LOCAL');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('COMMITTED — committed but not pushed', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);

      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');
      execSync('git add secret.env', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "add secret"', { cwd: dir, stdio: 'ignore' });

      const result = await assessExposure(filePath, dir);

      expect(result.level).toBe('COMMITTED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PUSHED — in remote-tracking refs', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);

      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');
      execSync('git add secret.env', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "add secret"', { cwd: dir, stdio: 'ignore' });

      // Simulate a remote-tracking ref pointing to current HEAD
      execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: dir, stdio: 'ignore' });

      const result = await assessExposure(filePath, dir);

      expect(result.level).toBe('PUSHED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('UNKNOWN — not a git repo', async () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');

      const result = await assessExposure(filePath, dir);

      expect(result.level).toBe('UNKNOWN');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Non-existent file — graceful result (LOCAL or UNKNOWN)', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);
      execSync('git commit -m "initial" --allow-empty', { cwd: dir, stdio: 'ignore' });

      const filePath = path.join(dir, 'does-not-exist.env');

      const result = await assessExposure(filePath, dir);

      expect(result).toHaveProperty('level');
      expect(['LOCAL', 'UNKNOWN']).toContain(result.level);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('result always has level, confidence, and details fields', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);

      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');
      execSync('git add secret.env', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "add secret"', { cwd: dir, stdio: 'ignore' });

      const result = await assessExposure(filePath, dir);

      expect(typeof result.level).toBe('string');
      expect(typeof result.confidence).toBe('string');
      expect(typeof result.details).toBe('string');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PUSHED result includes exposureSince when available', async () => {
    const dir = createTempDir();
    try {
      gitInit(dir);

      const filePath = path.join(dir, 'secret.env');
      fs.writeFileSync(filePath, 'SECRET_KEY=abc123\n');
      execSync('git add secret.env', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "add secret"', { cwd: dir, stdio: 'ignore' });
      execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: dir, stdio: 'ignore' });

      const result = await assessExposure(filePath, dir);

      expect(result.level).toBe('PUSHED');
      // exposureSince may be present for PUSHED
      if (result.exposureSince !== undefined) {
        expect(typeof result.exposureSince).toBe('string');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// formatExposure tests
// ---------------------------------------------------------------------------

describe('formatExposure', () => {
  test('LOCAL — no color: shows "LOCAL ONLY"', () => {
    const out = formatExposure({ level: 'LOCAL', confidence: 'high', details: '' }, false);
    expect(out).toContain('LOCAL ONLY');
  });

  test('COMMITTED — no color: shows "COMMITTED"', () => {
    const out = formatExposure({ level: 'COMMITTED', confidence: 'high', details: '' }, false);
    expect(out).toContain('COMMITTED');
  });

  test('PUSHED — no color: shows "COMPROMISED"', () => {
    const out = formatExposure({ level: 'PUSHED', confidence: 'high', details: '' }, false);
    expect(out).toContain('COMPROMISED');
  });

  test('UNKNOWN — no color: shows "UNKNOWN"', () => {
    const out = formatExposure({ level: 'UNKNOWN', confidence: 'low', details: '' }, false);
    expect(out).toContain('UNKNOWN');
  });

  test('no color: output contains no ANSI escape codes', () => {
    const out = formatExposure({ level: 'PUSHED', confidence: 'high', details: '' }, false);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });

  test('with color: LOCAL uses green ANSI code', () => {
    const out = formatExposure({ level: 'LOCAL', confidence: 'high', details: '' }, true);
    // eslint-disable-next-line no-control-regex
    expect(out).toMatch(/\x1b\[/);
    expect(out).toContain('\x1b[32m'); // GREEN
  });

  test('with color: COMMITTED uses yellow ANSI code', () => {
    const out = formatExposure({ level: 'COMMITTED', confidence: 'high', details: '' }, true);
    expect(out).toContain('\x1b[33m'); // YELLOW
  });

  test('with color: PUSHED uses red ANSI code', () => {
    const out = formatExposure({ level: 'PUSHED', confidence: 'high', details: '' }, true);
    expect(out).toContain('\x1b[31m'); // RED
  });

  test('with color: UNKNOWN uses dim ANSI code', () => {
    const out = formatExposure({ level: 'UNKNOWN', confidence: 'low', details: '' }, true);
    expect(out).toContain('\x1b[2m'); // DIM
  });

  test('COMMITTED label includes "not pushed" text', () => {
    const out = formatExposure({ level: 'COMMITTED', confidence: 'high', details: '' }, false);
    expect(out).toMatch(/not pushed/i);
  });

  test('formatExposure returns a non-empty string for all levels', () => {
    const levels = ['LOCAL', 'COMMITTED', 'PUSHED', 'UNKNOWN'];
    for (const level of levels) {
      const out = formatExposure({ level, confidence: 'high', details: '' }, false);
      expect(typeof out).toBe('string');
      expect(out.trim().length).toBeGreaterThan(0);
    }
  });
});
