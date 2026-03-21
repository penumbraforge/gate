/**
 * Gate CLI update checker and updater
 *
 * - checkForUpdate(): non-blocking background check on every run
 * - runUpdate(): performs the actual update (gate update)
 * - detectInstallMethod(): determines how gate was installed
 *
 * Checks gate.penumbraforge.com/api/version for the latest release.
 * Caches for 24h at ~/.gate/update-check.json.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync, spawnSync } = require('child_process');

const GATE_DIR = path.join(require('os').homedir(), '.gate');
const CHECK_FILE = path.join(GATE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_API = 'https://gate.penumbraforge.com/api';
const GITHUB_REPO = 'penumbraforge/gate';

/**
 * Detect how gate was installed.
 *
 * @returns {'npm-global'|'git-clone'|'local'} Install method
 */
function detectInstallMethod() {
  const rootDir = path.resolve(__dirname, '..', '..');

  // Check if this is a git repo (cloned from source)
  const gitDir = path.join(rootDir, '.git');
  if (fs.existsSync(gitDir)) {
    return 'git-clone';
  }

  // Check if installed as a global npm package
  try {
    const globalDir = execSync('npm root -g', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (rootDir.startsWith(globalDir) || rootDir.includes('node_modules')) {
      return 'npm-global';
    }
  } catch {}

  return 'local';
}

/**
 * Get the appropriate update command based on install method.
 *
 * @param {string} method - Install method from detectInstallMethod()
 * @returns {{ cmd: string, desc: string }}
 */
function getUpdateCommand(method) {
  switch (method) {
    case 'npm-global':
      return {
        cmd: 'npm install -g @penumbra/gate@latest',
        desc: 'Update via npm',
      };
    case 'git-clone':
      return {
        cmd: 'git pull && npm install && npm run build',
        desc: 'Pull latest and rebuild',
      };
    default:
      return {
        cmd: `npm install -g @penumbra/gate@latest`,
        desc: 'Install latest version',
      };
  }
}

/**
 * Check if an update is available (non-blocking).
 * Returns immediately; prints notice to stdout if a newer version exists.
 * Skips all network calls when GATE_OFFLINE=1 is set.
 * Uses a 24-hour cache at ~/.gate/update-check.json.
 *
 * @param {string} currentVersion - e.g. "1.3.2"
 * @param {string} [apiUrl] - override API base URL
 */
function checkForUpdate(currentVersion, apiUrl) {
  if (process.env.GATE_OFFLINE === '1') return;

  setImmediate(async () => {
    try {
      const cached = readCache();
      if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
        if (cached.latestVersion && isNewer(cached.latestVersion, currentVersion)) {
          printNotice(currentVersion, cached.latestVersion);
        }
        return;
      }

      const baseUrl = apiUrl || DEFAULT_API;
      const url = `${baseUrl}/version`;
      const data = await fetchJSON(url);

      if (data && data.version) {
        writeCache(data.version);
        if (isNewer(data.version, currentVersion)) {
          printNotice(currentVersion, data.version);
        }
      }
    } catch {
      // Silent — never interrupt user workflow for update checks
    }
  });
}

/**
 * Check for update synchronously and print result.
 * Used by `gate update` and `gate status`.
 * Skips network call when GATE_OFFLINE=1 is set; returns cached result if available.
 *
 * @param {string} currentVersion
 * @param {string} [apiUrl]
 * @returns {Promise<{available: boolean, latest: string|null}>}
 */
async function checkForUpdateSync(currentVersion, apiUrl) {
  if (process.env.GATE_OFFLINE === '1') {
    const cached = readCache();
    if (cached && cached.latestVersion) {
      return { available: isNewer(cached.latestVersion, currentVersion), latest: cached.latestVersion };
    }
    return { available: false, latest: null };
  }

  // Return cached result if still fresh
  const cached = readCache();
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    if (cached.latestVersion) {
      return { available: isNewer(cached.latestVersion, currentVersion), latest: cached.latestVersion };
    }
  }

  try {
    const baseUrl = apiUrl || DEFAULT_API;
    const data = await fetchJSON(`${baseUrl}/version`);
    if (data && data.version) {
      writeCache(data.version);
      const available = isNewer(data.version, currentVersion);
      return { available, latest: data.version };
    }
  } catch {}
  return { available: false, latest: null };
}

/**
 * Perform the actual update.
 *
 * @param {string} currentVersion
 * @returns {Promise<boolean>} true if update was performed
 */
async function runUpdate(currentVersion) {
  const method = detectInstallMethod();
  const rootDir = path.resolve(__dirname, '..', '..');

  console.log(`Gate v${currentVersion}`);
  console.log(`Install method: ${method}`);
  console.log('');

  // Check for latest version
  console.log('Checking for updates...');
  const { available, latest } = await checkForUpdateSync(currentVersion);

  if (!available) {
    if (latest) {
      console.log(`Already on the latest version (v${latest}).`);
    } else {
      console.log('Could not reach update server. Check your connection.');
    }
    return false;
  }

  console.log(`Update available: v${currentVersion} \u2192 v${latest}`);
  console.log('');

  if (method === 'git-clone') {
    console.log('Updating from git...');

    // Check for uncommitted changes
    try {
      const status = execSync('git status --porcelain', {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (status) {
        console.log('Warning: you have uncommitted changes. Stash or commit them first.');
        console.log(`  cd ${rootDir}`);
        console.log('  git stash && gate update');
        return false;
      }
    } catch {}

    // Pull latest
    const pull = spawnSync('git', ['pull', '--ff-only'], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    if (pull.status !== 0) {
      console.log('');
      console.log('git pull failed. Try manually:');
      console.log(`  cd ${rootDir}`);
      console.log('  git pull --rebase');
      return false;
    }

    // Install dependencies
    console.log('');
    console.log('Installing dependencies...');
    const npmInstall = spawnSync('npm', ['install'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (npmInstall.status !== 0) {
      console.log('npm install failed.');
      return false;
    }

    // Build
    console.log('');
    console.log('Building...');
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) {
      console.log('Build failed.');
      return false;
    }

    console.log('');
    console.log(`Updated to v${latest}`);
    return true;
  }

  if (method === 'npm-global') {
    console.log('Updating via npm...');
    const npmUpdate = spawnSync('npm', ['install', '-g', '@penumbra/gate@latest'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (npmUpdate.status !== 0) {
      console.log('');
      console.log('npm install failed. Try manually:');
      console.log('  npm install -g @penumbra/gate@latest');
      console.log('');
      console.log('Or install from source:');
      console.log(`  git clone https://github.com/${GITHUB_REPO}.git`);
      console.log('  cd gate && npm install && npm run build');
      return false;
    }

    console.log('');
    console.log(`Updated to v${latest}`);
    return true;
  }

  // Fallback: show manual instructions
  console.log('Could not determine install method. Update manually:');
  console.log('');
  console.log('  Option 1 — npm:');
  console.log('    npm install -g @penumbra/gate@latest');
  console.log('');
  console.log('  Option 2 — git:');
  console.log(`    git clone https://github.com/${GITHUB_REPO}.git`);
  console.log('    cd gate && npm install && npm run build');
  return false;
}

// ─── Utilities ───

/**
 * Compare semver strings. Returns true if `a` is newer than `b`.
 */
function isNewer(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function printNotice(current, latest) {
  const method = detectInstallMethod();
  const { cmd } = getUpdateCommand(method);
  console.log('');
  console.log(`  Update available: v${current} \u2192 v${latest}`);
  console.log(`  Run "gate update" or: ${cmd}`);
  console.log('');
}

function readCache() {
  try {
    if (!fs.existsSync(CHECK_FILE)) return null;
    return JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(latestVersion) {
  try {
    if (!fs.existsSync(GATE_DIR)) {
      fs.mkdirSync(GATE_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      CHECK_FILE,
      JSON.stringify({ latestVersion, checkedAt: Date.now() }),
      { mode: 0o600 }
    );
  } catch {}
}

function fetchJSON(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = {
  checkForUpdate,
  checkForUpdateSync,
  runUpdate,
  detectInstallMethod,
  getUpdateCommand,
  isNewer,
};
