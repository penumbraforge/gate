const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-paths-test-'));
}

describe('paths', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GATE_HOME;
    process.chdir(originalCwd);
  });

  test('uses GATE_HOME override when provided', () => {
    const customHome = path.join(createTempDir(), 'custom-gate-home');
    process.env.GATE_HOME = customHome;

    jest.resetModules();
    const { getGateHome, getGatePath } = require('../paths');

    expect(getGateHome()).toBe(customHome);
    expect(getGatePath('audit.jsonl')).toBe(path.join(customHome, 'audit.jsonl'));
  });

  test('falls back to a repo-local .gate directory when ~/.gate is not writable', () => {
    const repoDir = createTempDir();
    process.chdir(repoDir);
    delete process.env.GATE_HOME;

    const realExistsSync = fs.existsSync.bind(fs);
    const realAccessSync = fs.accessSync.bind(fs);

    jest.spyOn(os, 'homedir').mockReturnValue('/restricted-home');
    jest.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      const resolved = path.resolve(targetPath);
      if (resolved === path.resolve('/restricted-home')) return true;
      if (resolved === path.resolve('/restricted-home/.gate')) return false;
      return realExistsSync(targetPath);
    });
    jest.spyOn(fs, 'accessSync').mockImplementation((targetPath, mode) => {
      if (path.resolve(targetPath) === path.resolve('/restricted-home')) {
        const error = new Error('permission denied');
        error.code = 'EPERM';
        throw error;
      }
      return realAccessSync(targetPath, mode);
    });

    jest.resetModules();
    const { getGateHome, ensureGateHome } = require('../paths');

    const ensuredHome = ensureGateHome();
    expect(fs.realpathSync(ensuredHome)).toBe(fs.realpathSync(path.join(repoDir, '.gate')));
    expect(fs.realpathSync(getGateHome())).toBe(fs.realpathSync(path.join(repoDir, '.gate')));
    expect(fs.existsSync(path.join(repoDir, '.gate'))).toBe(true);
  });
});
