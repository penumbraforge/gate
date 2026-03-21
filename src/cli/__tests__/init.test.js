const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-init-test-'));
}

function gitInit(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
}

describe('init', () => {
  let runInit;

  beforeEach(() => {
    jest.resetModules();
    runInit = require('../init').runInit;
  });

  test('detects Node.js project and creates .gateignore with node defaults', async () => {
    const dir = createTempDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');

    const result = await runInit(dir);

    expect(result.stacks).toContain('node');
    expect(result.gateignoreCreated).toBe(true);

    const gateignore = fs.readFileSync(path.join(dir, '.gateignore'), 'utf8');
    expect(gateignore).toContain('node_modules/**');
    expect(gateignore).toContain('# .gateignore — Gate scanner ignore patterns');

    fs.rmSync(dir, { recursive: true });
  });

  test('detects Python project and creates .gateignore with python defaults', async () => {
    const dir = createTempDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'requests==2.28.0\n');

    const result = await runInit(dir);

    expect(result.stacks).toContain('python');
    expect(result.gateignoreCreated).toBe(true);

    const gateignore = fs.readFileSync(path.join(dir, '.gateignore'), 'utf8');
    expect(gateignore).toContain('venv/**');
    expect(gateignore).toContain('__pycache__/**');

    fs.rmSync(dir, { recursive: true });
  });

  test('errors helpfully when not in a git repo', async () => {
    const dir = createTempDir();
    // No git init — no .git directory

    await expect(runInit(dir)).rejects.toThrow(/git repository/i);

    fs.rmSync(dir, { recursive: true });
  });

  test('adds .env entries to .gitignore', async () => {
    const dir = createTempDir();
    gitInit(dir);

    const result = await runInit(dir);

    expect(result.gitignoreUpdated).toBe(true);

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('.env.*.local');

    fs.rmSync(dir, { recursive: true });
  });

  test('does not duplicate .env in .gitignore if already present', async () => {
    const dir = createTempDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.local\n.env.*.local\n.gate/\n');

    const result = await runInit(dir);

    expect(result.gitignoreUpdated).toBe(false);

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const envCount = (gitignore.match(/^\.env$/m) || []).length;
    expect(envCount).toBe(1);

    fs.rmSync(dir, { recursive: true });
  });

  test('creates .gitignore if it does not exist', async () => {
    const dir = createTempDir();
    gitInit(dir);

    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);

    await runInit(dir);

    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');

    fs.rmSync(dir, { recursive: true });
  });

  test('does not overwrite existing .gateignore (idempotency)', async () => {
    const dir = createTempDir();
    gitInit(dir);
    const existingContent = '# my custom ignore\nmy-secret-file.txt\n';
    fs.writeFileSync(path.join(dir, '.gateignore'), existingContent);

    const result = await runInit(dir);

    expect(result.gateignoreCreated).toBe(false);

    const gateignore = fs.readFileSync(path.join(dir, '.gateignore'), 'utf8');
    expect(gateignore).toBe(existingContent);

    fs.rmSync(dir, { recursive: true });
  });

  test('returns result object with expected shape', async () => {
    const dir = createTempDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');

    const result = await runInit(dir);

    expect(result).toHaveProperty('hookInstalled');
    expect(result).toHaveProperty('gateignoreCreated');
    expect(result).toHaveProperty('gitignoreUpdated');
    expect(result).toHaveProperty('stacks');
    expect(Array.isArray(result.stacks)).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });
});
