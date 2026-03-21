/**
 * Exposure Assessment Module
 *
 * Determines how exposed a secret is based on git state, used by the
 * remediation engine to decide what action is required.
 *
 * Levels:
 *   LOCAL     — file is staged but never committed. Safe to just extract.
 *   COMMITTED — in local commits but not pushed. Extract + amend commit.
 *   PUSHED    — in remote-tracking branches. Full incident response required.
 *   UNKNOWN   — can't determine. Treat as potentially exposed.
 */

'use strict';

const { execFileSync } = require('child_process');
const { GREEN, YELLOW, RED, BOLD, DIM, RESET } = require('./output');

/**
 * Run a git command and return stdout as a string, or null on error.
 * @param {string[]} args - git arguments
 * @param {string} cwd
 * @returns {string|null}
 */
function runGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Check if git is available and the directory is a git repo.
 * @param {string} cwd
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  const result = runGit(['rev-parse', '--git-dir'], cwd);
  return result !== null;
}

/**
 * Check if HEAD exists (i.e. there is at least one commit).
 * @param {string} cwd
 * @returns {boolean}
 */
function headExists(cwd) {
  const result = runGit(['rev-parse', '--verify', 'HEAD'], cwd);
  return result !== null;
}

/**
 * Check if the file is staged (in the index) but not in HEAD.
 * Returns true when the file appears in the index diff against HEAD.
 * @param {string} filePath  — absolute path to file
 * @param {string} cwd
 * @returns {boolean}
 */
function isStagedOnly(filePath, cwd) {
  // If there is no HEAD yet, any staged file counts as staged-only.
  if (!headExists(cwd)) {
    const staged = runGit(['diff', '--cached', '--name-only', '--', filePath], cwd);
    return staged !== null && staged.length > 0;
  }
  // Diff the index against HEAD — if the file appears, it's staged but not committed.
  const staged = runGit(['diff', '--cached', '--name-only', 'HEAD', '--', filePath], cwd);
  return staged !== null && staged.length > 0;
}

/**
 * Check if the file appears in any commit reachable from any ref.
 * @param {string} filePath
 * @param {string} cwd
 * @returns {boolean}
 */
function isInAnyCommit(filePath, cwd) {
  const result = runGit(['log', '--all', '--oneline', '--', filePath], cwd);
  return result !== null && result.length > 0;
}

/**
 * Check if the file appears in any remote-tracking branch.
 * @param {string} filePath
 * @param {string} cwd
 * @returns {boolean}
 */
function isInRemote(filePath, cwd) {
  const result = runGit(['log', '--remotes', '--oneline', '--', filePath], cwd);
  return result !== null && result.length > 0;
}

/**
 * Get the ISO timestamp of when the file was first introduced to a remote ref.
 * @param {string} filePath
 * @param {string} cwd
 * @returns {string|null}
 */
function getRemoteExposureDate(filePath, cwd) {
  // --diff-filter=A finds the commit that Added the file; --follow handles renames.
  // We use --format=%aI for ISO 8601 strict format.
  const result = runGit(
    ['log', '--remotes', '--diff-filter=A', '--format=%aI', '--', filePath],
    cwd
  );
  if (!result) return null;
  // There may be multiple lines — return the earliest (last line, since git log
  // outputs newest-first).
  const lines = result.split('\n').filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/**
 * Assess the exposure level of a secret in the given file.
 *
 * @param {string} filePath — absolute or relative path to the file
 * @param {string} cwd      — working directory (defaults to process.cwd())
 * @returns {Promise<{level: string, confidence: string, details: string, exposureSince?: string}>}
 */
async function assessExposure(filePath, cwd = process.cwd()) {
  try {
    if (!isGitRepo(cwd)) {
      return {
        level: 'UNKNOWN',
        confidence: 'low',
        details: 'Not a git repository — cannot assess exposure.',
      };
    }

    // Step 1: staged but never committed → LOCAL
    if (isStagedOnly(filePath, cwd)) {
      // Confirm it has no commit history either
      if (!isInAnyCommit(filePath, cwd)) {
        return {
          level: 'LOCAL',
          confidence: 'high',
          details: 'File is staged but has never been committed.',
        };
      }
    }

    // Step 2: not in any commit at all → LOCAL (untracked/staged new file)
    if (!isInAnyCommit(filePath, cwd)) {
      return {
        level: 'LOCAL',
        confidence: 'high',
        details: 'File has no commit history.',
      };
    }

    // Step 3: in remote-tracking branches → PUSHED
    if (isInRemote(filePath, cwd)) {
      const exposureSince = getRemoteExposureDate(filePath, cwd);
      const result = {
        level: 'PUSHED',
        confidence: 'high',
        details: 'File exists in remote-tracking refs — treat as publicly exposed.',
      };
      if (exposureSince) {
        result.exposureSince = exposureSince;
        result.details += ` First pushed: ${exposureSince}.`;
      }
      return result;
    }

    // Step 4: in commits but not remote → COMMITTED
    return {
      level: 'COMMITTED',
      confidence: 'high',
      details: 'File is committed locally but has not been pushed to any remote.',
    };
  } catch {
    return {
      level: 'UNKNOWN',
      confidence: 'low',
      details: 'Error while assessing git state.',
    };
  }
}

/**
 * Format an exposure result for terminal output.
 *
 * @param {{ level: string, confidence: string, details: string }} exposure
 * @param {boolean} useColor
 * @returns {string}
 */
function formatExposure(exposure, useColor) {
  const { level } = exposure;

  switch (level) {
    case 'LOCAL':
      if (useColor) return `${GREEN}LOCAL ONLY${RESET}`;
      return 'LOCAL ONLY';

    case 'COMMITTED':
      if (useColor) return `${YELLOW}COMMITTED${RESET} — not pushed`;
      return 'COMMITTED — not pushed';

    case 'PUSHED':
      if (useColor) return `${BOLD}${RED}COMPROMISED${RESET}`;
      return 'COMPROMISED';

    case 'UNKNOWN':
    default:
      if (useColor) return `${DIM}UNKNOWN${RESET}`;
      return 'UNKNOWN';
  }
}

module.exports = { assessExposure, formatExposure };
