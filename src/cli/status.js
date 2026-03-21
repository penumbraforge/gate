/**
 * Gate status health check
 * Shows a summary of Gate's current installation state
 */

const fs = require('fs');
const path = require('path');

const { isInstalled } = require('./installer');
const { getRules } = require('./rules');
const { readAuditLog, getStatistics } = require('./audit');
const { loadConfig } = require('./config');
const { BOLD, DIM, RESET, GREEN, RED } = require('./output');

/**
 * Read ignore count from .gateignore — counts non-blank, non-comment lines.
 *
 * @param {string} dir - Directory to look in
 * @returns {number}
 */
function readIgnoreCount(dir) {
  const ignorePath = path.join(dir, '.gateignore');
  if (!fs.existsSync(ignorePath)) return 0;

  try {
    const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
    return lines.filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    }).length;
  } catch {
    return 0;
  }
}

/**
 * Check whether the pre-push hook is installed in this repo.
 * Looks for .git/hooks/pre-push that invokes 'gate' as a command
 * (i.e., 'gate' appears at the start of a command line or via a variable,
 * not merely as a substring inside a quoted argument).
 *
 * @param {string} dir - Repo root directory
 * @returns {boolean}
 */
function checkPrePushHook(dir) {
  try {
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-push');
    if (!fs.existsSync(hookPath)) return false;
    const content = fs.readFileSync(hookPath, 'utf8');
    // Match 'gate' when it appears as a command invocation:
    // - At the start of a line (optionally preceded by whitespace or $)
    // - Followed by whitespace, end-of-line, or a slash (e.g. bin/gate)
    // This avoids matching 'gate' inside quoted strings like echo "not gate"
    return /(?:^|[\s$])gate(?:\s|\/|$)/m.test(content);
  } catch {
    return false;
  }
}

/**
 * Format a relative time string from a timestamp.
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
function relativeTime(isoTimestamp) {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

/**
 * Collect status information for the given directory.
 *
 * @param {string} [dir] - Directory to inspect (defaults to cwd)
 * @returns {Promise<object>} Status object
 */
async function getStatus(dir) {
  dir = dir || process.cwd();

  // Version from package.json
  const pkg = require('../../package.json');
  const version = pkg.version;

  // Hook status
  const hookPreCommit = isInstalled();
  const hookPrePush = checkPrePushHook(dir);

  // Config source
  const gateRcPath = path.join(dir, '.gaterc');
  const configSource = fs.existsSync(gateRcPath) ? '.gaterc' : 'defaults';

  // Ignore pattern count
  const ignoreCount = readIgnoreCount(dir);

  // Rule count
  const ruleCount = getRules().length;

  // Audit data
  const auditEntries = readAuditLog();
  const entries = Array.isArray(auditEntries) ? auditEntries : [];
  const lastScan = entries.length > 0 ? entries[entries.length - 1] : null;
  const auditStats = getStatistics();

  return {
    version,
    hookPreCommit,
    hookPrePush,
    configSource,
    ignoreCount,
    ruleCount,
    lastScan,
    auditStats,
  };
}

/**
 * Format the status object for terminal display.
 *
 * @param {object} status - Result of getStatus()
 * @param {boolean} useColor - Whether to use ANSI color codes
 * @returns {string}
 */
function formatStatus(status, useColor) {
  const b = (s) => (useColor ? `${BOLD}${s}${RESET}` : s);
  const d = (s) => (useColor ? `${DIM}${s}${RESET}` : s);
  const ok = (s) => (useColor ? `${GREEN}${s}${RESET}` : s);
  const fail = (s) => (useColor ? `${RED}${s}${RESET}` : s);

  const LABEL_WIDTH = 10;
  const label = (name) => name.padEnd(LABEL_WIDTH);

  const lines = [];

  // Header: version
  lines.push(`  ${b('gate')} ${d('v' + status.version)}`);
  lines.push('');

  // Hook status
  const pcMark = status.hookPreCommit ? ok('✓') : fail('✗');
  const ppMark = status.hookPrePush ? ok('✓') : fail('✗');
  lines.push(
    `  ${d(label('hook'))}pre-commit ${pcMark}  pre-push ${ppMark}`
  );

  // Config source
  lines.push(`  ${d(label('config'))}${status.configSource}`);

  // Ignore patterns
  const ignoreSuffix =
    status.ignoreCount === 1 ? '1 pattern' : `${status.ignoreCount} patterns`;
  lines.push(
    `  ${d(label('ignore'))}${status.ignoreCount === 0 ? d('none') : `.gateignore (${ignoreSuffix})`}`
  );

  // Rules
  lines.push(`  ${d(label('rules'))}${status.ruleCount} patterns`);

  // Last scan
  if (status.lastScan) {
    const when = relativeTime(status.lastScan.timestamp);
    const fileCount = Array.isArray(status.lastScan.filesScanned)
      ? status.lastScan.filesScanned.length
      : 0;
    const findings = status.lastScan.findingCount || 0;
    const findingStr =
      findings === 0 ? '0 findings' : `${findings} finding${findings !== 1 ? 's' : ''}`;
    lines.push(
      `  ${d(label('last scan'))}${when} · ${fileCount} file${fileCount !== 1 ? 's' : ''} · ${findingStr}`
    );
  } else {
    lines.push(`  ${d(label('last scan'))}${d('never')}`);
  }

  // Audit stats
  if (status.auditStats) {
    const stats = status.auditStats;
    const totalScans = stats.totalScans || 0;
    const findings = stats.totalFindingsLogged || 0;
    const scanStr = `${totalScans} scan${totalScans !== 1 ? 's' : ''}`;
    const findingStr =
      findings === 0
        ? '0 findings'
        : `${findings} finding${findings !== 1 ? 's' : ''} logged`;
    lines.push(`  ${d(label('audit'))}${scanStr} · ${findingStr}`);
  }

  return lines.join('\n');
}

module.exports = { getStatus, formatStatus };
