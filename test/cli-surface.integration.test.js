'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

const GATE_BIN = path.join(__dirname, '..', 'bin', 'gate.js');

function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cli-int-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runGate(args, cwd) {
  try {
    return {
      code: 0,
      stdout: execFileSync('node', [GATE_BIN, ...args], {
        cwd,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
      }),
    };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

describe('CLI surface integration', () => {
  test('--version works as a top-level flag', () => {
    const result = runGate(['--version'], process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Gate v');
  });

  test('scan on a directory recursively inspects nested files', () => {
    const dir = createTempRepo();
    try {
      fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'nested', 'config.js'),
        'const key = "sk_live_00000000000000000000000000";\n'
      );

      const result = runGate(['scan', 'src', '--format', 'json', '--no-verify'], dir);
      expect(result.code).toBe(1);

      const parsed = JSON.parse(result.stdout);
      expect(parsed.summary.totalFindings).toBeGreaterThan(0);
      expect(parsed.findings.some((finding) => String(finding.file).includes('config.js'))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test('fix defaults to tracked files, not only staged files', () => {
    const dir = createTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }, null, 2));
      fs.writeFileSync(path.join(dir, 'config.js'), 'const key = process.env.STRIPE_SECRET_KEY;\n');
      execSync('git add package.json config.js', { cwd: dir, stdio: 'ignore' });
      execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

      fs.writeFileSync(path.join(dir, 'config.js'), 'const key = "sk_live_00000000000000000000000000";\n');

      const result = runGate(['fix', '--no-verify'], dir);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Fixed 1 finding');

      const content = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
      expect(content).toContain('process.env.STRIPE_SECRET_KEY');
      expect(content).not.toContain('sk_live_00000000000000000000000000');
    } finally {
      cleanup(dir);
    }
  });
});
