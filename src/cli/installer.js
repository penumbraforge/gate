/**
 * Git hook installer
 * Creates/removes pre-commit and pre-push hooks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GATE_SECTION_START = '# --- Gate hook start ---';
const GATE_SECTION_END = '# --- Gate hook end ---';

/**
 * Detect the git root directory
 *
 * @param {string} [cwd]  Directory to search from (defaults to process.cwd())
 * @returns {string|null} Path to git root or null
 */
function findGitRoot(cwd) {
  try {
    const gitRoot = execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      cwd: cwd || process.cwd(),
    }).trim();

    // If result is relative, make it absolute
    if (!path.isAbsolute(gitRoot)) {
      return path.resolve(cwd || process.cwd(), gitRoot);
    }

    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Get the path to the hooks directory
 *
 * @param {string} [cwd]  Directory to search from (defaults to process.cwd())
 * @returns {string|null} Path to hooks directory or null
 */
function getHooksDir(cwd) {
  const workDir = cwd || process.cwd();
  const gitRoot = findGitRoot(workDir);
  if (!gitRoot) return null;

  // Check for custom hooks path configured via git
  try {
    const customPath = execSync('git config core.hooksPath', {
      encoding: 'utf8', cwd: workDir,
    }).trim();
    if (customPath) {
      const resolved = path.isAbsolute(customPath) ? customPath : path.resolve(workDir, customPath);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      return resolved;
    }
  } catch {
    // No custom hooksPath configured
  }

  // If .git is a file (worktree), we need to parse it
  const dotGitPath = path.resolve(workDir, '.git');
  if (fs.existsSync(dotGitPath)) {
    const stat = fs.statSync(dotGitPath);
    if (stat.isDirectory()) {
      return path.join(dotGitPath, 'hooks');
    } else if (stat.isFile()) {
      // Parse git worktree file
      const content = fs.readFileSync(dotGitPath, 'utf8');
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        const gitDir = match[1].trim();
        const resolvedDir = path.isAbsolute(gitDir)
          ? gitDir
          : path.resolve(path.dirname(dotGitPath), gitDir);
        return path.join(resolvedDir, 'hooks');
      }
    }
  }

  return path.join(gitRoot, 'hooks');
}

/**
 * Generate the Gate hook section for a given hook type.
 * This block is wrapped in sentinel comments so it can be identified and updated.
 *
 * @param {'pre-commit'|'pre-push'} hookType
 * @returns {string}
 */
function generateHookSection(hookType) {
  const isPush = hookType === 'pre-push';
  const scanArgs = isPush ? '--changed' : '--staged';
  const description = isPush
    ? 'Scans files changed since upstream branch before push'
    : 'Scans staged files for secrets before commit';

  return `${GATE_SECTION_START}
# Gate ${hookType} hook
# ${description}
# Set GATE_SKIP=1 to bypass (for trusted commits of source code that handles secrets)

if [ "$GATE_SKIP" = "1" ]; then
  echo "Gate scan skipped (GATE_SKIP=1)"
  exit 0
fi

export GATE_HOOK_TYPE=${hookType}

# Find Node.js — checks explicit override, PATH, nvm, fnm, volta, common locations
find_gate_node() {
  if [ -n "$GATE_NODE_PATH" ] && [ -x "$GATE_NODE_PATH" ]; then echo "$GATE_NODE_PATH"; return; fi
  command -v node 2>/dev/null && return
  if [ -s "\${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then . "\${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null; command -v node 2>/dev/null && return; fi
  if [ -x "$HOME/.fnm/fnm" ]; then eval "$("$HOME/.fnm/fnm" env 2>/dev/null)"; command -v node 2>/dev/null && return; fi
  if [ -x "$HOME/.volta/bin/node" ]; then echo "$HOME/.volta/bin/node"; return; fi
  for p in /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$p" ] && echo "$p" && return
  done
  return 1
}

GATE_NODE="$(find_gate_node)"
if [ -z "$GATE_NODE" ]; then
  echo "Gate: Node.js not found. Install Node 18+ or set GATE_NODE_PATH=/path/to/node"
  exit 1
fi

# Find gate binary: local bin/gate.js > node_modules/.bin/gate > ~/.gate/bin/gate > PATH
GATE_BIN=""
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || cd "$HOOK_DIR/../.." && pwd)"

if [ -f "$REPO_DIR/bin/gate.js" ]; then
  GATE_BIN="$GATE_NODE $REPO_DIR/bin/gate.js"
elif [ -f "$REPO_DIR/node_modules/.bin/gate" ]; then
  GATE_BIN="$REPO_DIR/node_modules/.bin/gate"
elif [ -f "$HOME/.gate/bin/gate" ]; then
  GATE_BIN="$HOME/.gate/bin/gate"
elif command -v gate >/dev/null 2>&1; then
  GATE_BIN="gate"
else
  echo "Gate not found. Commit blocked for safety." # gate-ignore
  echo "Set GATE_ALLOW_MISSING=1 to bypass" # gate-ignore
  if [ "$GATE_ALLOW_MISSING" = "1" ]; then exit 0; fi
  exit 1
fi

# Run gate scan
$GATE_BIN scan ${scanArgs}

exit $?
${GATE_SECTION_END}`;
}

/**
 * Generate a standalone hook script (for new hook files).
 *
 * @param {'pre-commit'|'pre-push'} hookType
 * @returns {string}
 */
function generateHookScript(hookType) {
  hookType = hookType || 'pre-commit';
  return `#!/bin/sh
${generateHookSection(hookType)}
`;
}

/**
 * Install a git hook (pre-commit or pre-push).
 *
 * Behaviour:
 * - If no hook file exists: creates a new one with the Gate script.
 * - If a hook file exists that already contains Gate: replaces the Gate section in place.
 * - If a hook file exists without Gate: appends the Gate section (preserves existing hooks).
 *
 * @param {'pre-commit'|'pre-push'} [hookType='pre-commit']
 * @param {string} [cwd]  Directory to search from (defaults to process.cwd())
 * @returns {{ success: boolean, hookPath?: string, message?: string, error?: string }}
 */
function install(hookType, cwd) {
  hookType = hookType || 'pre-commit';

  try {
    const hooksDir = getHooksDir(cwd);

    if (!hooksDir) {
      return {
        success: false,
        error: 'Could not find .git directory. Make sure you are in a git repository.',
      };
    }

    // Create hooks directory if it doesn't exist
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const hookPath = path.join(hooksDir, hookType);
    const gateSection = generateHookSection(hookType);

    if (!fs.existsSync(hookPath)) {
      // No existing hook — create a fresh one
      fs.writeFileSync(hookPath, `#!/bin/sh\n${gateSection}\n`, { encoding: 'utf8' });
    } else {
      const existing = fs.readFileSync(hookPath, 'utf8');

      if (existing.includes('gate') || existing.includes(GATE_SECTION_START)) {
        // Hook already contains Gate — replace the Gate section in place
        let updated;
        if (existing.includes(GATE_SECTION_START)) {
          // Replace the sentineled section
          const regex = new RegExp(
            `${escapeRegex(GATE_SECTION_START)}[\\s\\S]*?${escapeRegex(GATE_SECTION_END)}`,
            'g'
          );
          updated = existing.replace(regex, gateSection);
        } else {
          // Old-style gate hook without sentinels — replace entirely
          updated = `#!/bin/sh\n${gateSection}\n`;
        }
        fs.writeFileSync(hookPath, updated, { encoding: 'utf8' });
      } else {
        // Existing non-Gate hook — append Gate section
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(hookPath, existing + separator + gateSection + '\n', { encoding: 'utf8' });
      }
    }

    // Ensure the hook file is executable
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {
      // Windows may not support chmod, but Git Bash should work
    }

    return {
      success: true,
      hookPath,
      message: `${hookType} hook installed at ${hookPath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Cannot install ${hookType} hook: ${error.message}. Check .git/hooks/ permissions.`,
    };
  }
}

/**
 * Uninstall a git hook.
 *
 * If the hook file was entirely created by Gate (contains only Gate's section),
 * the file is deleted. Otherwise only the Gate section is removed.
 *
 * @param {'pre-commit'|'pre-push'} [hookType='pre-commit']
 * @param {string} [cwd]  Directory to search from (defaults to process.cwd())
 * @returns {{ success: boolean, message?: string, error?: string }}
 */
function uninstall(hookType, cwd) {
  hookType = hookType || 'pre-commit';

  try {
    const hooksDir = getHooksDir(cwd);

    if (!hooksDir) {
      return {
        success: false,
        error: 'Could not find .git directory.',
      };
    }

    const hookPath = path.join(hooksDir, hookType);

    if (!fs.existsSync(hookPath)) {
      return {
        success: true,
        message: `${hookType} hook was not installed.`,
      };
    }

    const content = fs.readFileSync(hookPath, 'utf8');

    if (content.includes(GATE_SECTION_START)) {
      // Remove the sentineled Gate section
      const regex = new RegExp(
        `\n?${escapeRegex(GATE_SECTION_START)}[\\s\\S]*?${escapeRegex(GATE_SECTION_END)}\n?`,
        'g'
      );
      const updated = content.replace(regex, '').trimEnd();

      // If nothing meaningful remains beyond a shebang, delete the file
      const nonShebangContent = updated.replace(/^#!\/.*\n?/, '').trim();
      if (!nonShebangContent) {
        fs.unlinkSync(hookPath);
      } else {
        fs.writeFileSync(hookPath, updated + '\n', { encoding: 'utf8' });
      }
    } else {
      // Old-style gate hook or whole file is gate's — just delete it
      fs.unlinkSync(hookPath);
    }

    return {
      success: true,
      message: `${hookType} hook removed from ${hookPath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Check if a gate hook is installed
 *
 * @param {'pre-commit'|'pre-push'} [hookType='pre-commit']
 * @param {string} [cwd]
 * @returns {boolean} True if hook exists
 */
function isInstalled(hookType, cwd) {
  hookType = hookType || 'pre-commit';
  try {
    const hooksDir = getHooksDir(cwd);
    if (!hooksDir) return false;

    const hookPath = path.join(hooksDir, hookType);
    if (!fs.existsSync(hookPath)) return false;
    const content = fs.readFileSync(hookPath, 'utf8');
    return content.includes(GATE_SECTION_START) || content.includes('gate scan');
  } catch {
    return false;
  }
}

/**
 * Get hook path
 *
 * @param {'pre-commit'|'pre-push'} [hookType='pre-commit']
 * @param {string} [cwd]
 * @returns {string|null} Hook path or null
 */
function getHookPath(hookType, cwd) {
  hookType = hookType || 'pre-commit';
  try {
    const hooksDir = getHooksDir(cwd);
    if (!hooksDir) return null;

    return path.join(hooksDir, hookType);
  } catch {
    return null;
  }
}

/**
 * Escape a string for use in a RegExp
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  install,
  uninstall,
  isInstalled,
  getHookPath,
  getHooksDir,
  findGitRoot,
  generateHookScript,
  generateHookSection,
};
