const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-installer-test-'));
}

function gitInit(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
}

describe('installer', () => {
  let install, uninstall, isInstalled, getHookPath;

  beforeEach(() => {
    jest.resetModules();
    ({ install, uninstall, isInstalled, getHookPath } = require('../installer'));
  });

  test('installs pre-commit hook — creates .git/hooks/pre-commit with correct content', () => {
    const dir = createTempDir();
    gitInit(dir);

    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('gate');
    expect(content).toContain('--staged');

    fs.rmSync(dir, { recursive: true });
  });

  test('installs pre-push hook — creates .git/hooks/pre-push with gate scan --changed', () => {
    const dir = createTempDir();
    gitInit(dir);

    const result = install('pre-push', dir);

    expect(result.success).toBe(true);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-push');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('gate');
    expect(content).toContain('--changed');

    fs.rmSync(dir, { recursive: true });
  });

  test('does not overwrite existing non-gate hook — appends gate hook code', () => {
    const dir = createTempDir();
    gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const existingContent = '#!/bin/sh\n# husky hook\nnpm run lint\n';
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, existingContent, 'utf8');

    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    // Original content preserved
    expect(content).toContain('npm run lint');
    // Gate content appended
    expect(content).toContain('gate');
    expect(content).toContain('--staged');

    fs.rmSync(dir, { recursive: true });
  });

  test('updates existing gate hook in place (does not duplicate)', () => {
    const dir = createTempDir();
    gitInit(dir);

    // First install
    install('pre-commit', dir);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    const contentAfterFirst = fs.readFileSync(hookPath, 'utf8');

    // Second install — should update in place, not append
    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    const contentAfterSecond = fs.readFileSync(hookPath, 'utf8');
    // Content should be same length/structure, not doubled
    expect(contentAfterSecond).toBe(contentAfterFirst);

    fs.rmSync(dir, { recursive: true });
  });

  test('foreign hook containing the word "navigate" survives install', () => {
    const dir = createTempDir();
    gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Contains the substring "gate" (navigate, delegate) but is NOT gate-managed
    const foreignContent = '#!/bin/sh\n# navigate to repo root and delegate to lint\nnpm run navigate-lint\n';
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, foreignContent, 'utf8');

    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    // Foreign hook content fully preserved
    expect(content).toContain('npm run navigate-lint');
    expect(content).toContain('# navigate to repo root and delegate to lint');
    // Gate section appended with sentinels
    expect(content).toContain('# --- Gate hook start ---');
    expect(content).toContain('# --- Gate hook end ---');

    fs.rmSync(dir, { recursive: true });
  });

  test('installing twice over a foreign hook yields exactly one gate section', () => {
    const dir = createTempDir();
    gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\n./scripts/gate-keeper.sh\n', 'utf8');

    install('pre-commit', dir);
    install('pre-commit', dir);

    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('./scripts/gate-keeper.sh');
    expect(content.split('# --- Gate hook start ---').length - 1).toBe(1);
    expect(content.split('# --- Gate hook end ---').length - 1).toBe(1);

    fs.rmSync(dir, { recursive: true });
  });

  test('legacy hook with sentinel gets its section replaced, not duplicated', () => {
    const dir = createTempDir();
    gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    // Simulate an older gate-managed hook plus surrounding foreign content
    const legacy = [
      '#!/bin/sh',
      'echo "pre-existing step"',
      '# --- Gate hook start ---',
      '# old gate hook body (stale)',
      'gate scan --staged',
      '# --- Gate hook end ---',
      'echo "post step"',
      '',
    ].join('\n');
    fs.writeFileSync(hookPath, legacy, 'utf8');

    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    // Surrounding content preserved
    expect(content).toContain('echo "pre-existing step"');
    expect(content).toContain('echo "post step"');
    // Stale body replaced by the current section — exactly one section
    expect(content).not.toContain('# old gate hook body (stale)');
    expect(content.split('# --- Gate hook start ---').length - 1).toBe(1);
    expect(content).toContain('find_gate_node');

    fs.rmSync(dir, { recursive: true });
  });

  test('uninstall leaves non-gate hooks untouched', () => {
    const dir = createTempDir();
    gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    const foreign = '#!/bin/sh\n# aggregate lint results\nnpm run lint\n';
    fs.writeFileSync(hookPath, foreign, 'utf8');

    const result = uninstall('pre-commit', dir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf8')).toBe(foreign);

    fs.rmSync(dir, { recursive: true });
  });

  test('uninstalls gate hook — removes the hook file', () => {
    const dir = createTempDir();
    gitInit(dir);

    install('pre-commit', dir);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    expect(fs.existsSync(hookPath)).toBe(true);

    const result = uninstall('pre-commit', dir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(hookPath)).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });

  test('creates .git/hooks/ directory if it does not exist', () => {
    const dir = createTempDir();
    gitInit(dir);
    // Remove the hooks directory if git init created it
    const hooksDir = path.join(dir, '.git', 'hooks');
    if (fs.existsSync(hooksDir)) {
      fs.rmSync(hooksDir, { recursive: true });
    }
    expect(fs.existsSync(hooksDir)).toBe(false);

    const result = install('pre-commit', dir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(hooksDir)).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  test('sets executable permission on hook file (mode 0o755)', () => {
    const dir = createTempDir();
    gitInit(dir);

    install('pre-commit', dir);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    const stat = fs.statSync(hookPath);
    // Check owner execute bit (0o100) is set
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o111).toBeTruthy();

    fs.rmSync(dir, { recursive: true });
  });

  test('errors helpfully when not in a git repo', () => {
    const dir = createTempDir();
    // No git init — no .git directory

    const result = install('pre-commit', dir);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/git repository/i);

    fs.rmSync(dir, { recursive: true });
  });

  test('hook template contains Node resolution chain', () => {
    const { generateHookSection } = require('../installer');
    const section = generateHookSection('pre-commit');

    expect(section).toContain('GATE_NODE_PATH');
    expect(section).toContain('nvm');
    expect(section).toContain('.fnm');
    expect(section).toContain('.volta');
    expect(section).toContain('/opt/homebrew/bin/node');
    expect(section).toContain('Node.js not found');
  });

  test('hook template uses GATE_NODE for running gate', () => {
    const { generateHookSection } = require('../installer');
    const section = generateHookSection('pre-commit');
    expect(section).toContain('GATE_NODE="$(find_gate_node)"');
    expect(section).toContain('$GATE_NODE $REPO_DIR/bin/gate.js');
  });

  test('pre-push hook uses --changed flag', () => {
    const { generateHookSection } = require('../installer');
    const section = generateHookSection('pre-push');
    expect(section).toContain('scan --changed');
    expect(section).not.toContain('scan --all');
  });

  test('pre-commit hook still uses --staged flag', () => {
    const { generateHookSection } = require('../installer');
    const section = generateHookSection('pre-commit');
    expect(section).toContain('scan --staged');
  });
});
