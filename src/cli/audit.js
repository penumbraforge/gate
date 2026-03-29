/**
 * Audit logging module for Gate
 * Records all scans with integrity verification via hash chain
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const AUDIT_LOG_PATH = path.join(os.homedir(), '.gate', 'audit.jsonl');

/**
 * Ensure audit directory exists
 */
function ensureAuditDir() {
  const dir = path.dirname(AUDIT_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Calculate SHA256 hash of content
 *
 * @param {string} content - Content to hash
 * @returns {string} Hex hash
 */
function calculateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get hash of previous entry (for chain integrity)
 *
 * @returns {string} Previous entry hash or null
 */
function getPreviousHash() {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) {
      return null;
    }

    const lines = fs
      .readFileSync(AUDIT_LOG_PATH, 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    if (lines.length === 0) return null;

    const lastLine = JSON.parse(lines[lines.length - 1]);
    return lastLine.hash || null;
  } catch {
    return null;
  }
}

/**
 * Record a scan to the audit log
 *
 * @param {object} entry - Audit entry
 * @param {string} [entry.version] - Gate version string (from package.json)
 * @param {*} [entry.verification] - Per-finding verification status (Phase 2, default: null)
 * @param {*} [entry.exposure] - Per-finding exposure level (Phase 2, default: null)
 * @param {string} [entry.action] - Action taken: 'fixed'|'ignored'|'skipped'|'none' (default: 'none')
 * @param {string|null} [entry.actionDetails] - Description of the action (default: null)
 * @returns {boolean} Success
 */
function recordScan(entry) {
  try {
    ensureAuditDir();

    // Mask raw secret matches before writing to disk
    const maskedFindings = (entry.findings || []).map((f) => ({
      ...f,
      match: f.match && f.match.length > 8
        ? `${f.match.slice(0, 4)}****`
        : '***',
    }));

    const auditEntry = {
      timestamp: new Date().toISOString(),
      version: entry.version || null,
      commitHash: entry.commitHash || 'unknown',
      filesScanned: entry.filesScanned || [],
      findings: maskedFindings,
      findingCount: maskedFindings.length,
      severityCounts: entry.severityCounts || {},
      userDecision: entry.userDecision || null,
      verification: entry.verification !== undefined ? entry.verification : null,
      exposure: entry.exposure !== undefined ? entry.exposure : null,
      action: entry.action || 'none',
      actionDetails: entry.actionDetails || null,
      previousHash: getPreviousHash(),
    };

    // Calculate hash of this entry (for chain integrity)
    const entryContent = JSON.stringify({
      timestamp: auditEntry.timestamp,
      version: auditEntry.version,
      commitHash: auditEntry.commitHash,
      filesScanned: auditEntry.filesScanned,
      findings: auditEntry.findings,
      findingCount: auditEntry.findingCount,
      severityCounts: auditEntry.severityCounts,
      userDecision: auditEntry.userDecision,
      verification: auditEntry.verification,
      exposure: auditEntry.exposure,
      action: auditEntry.action,
      actionDetails: auditEntry.actionDetails,
      previousHash: auditEntry.previousHash,
    });

    auditEntry.hash = calculateHash(entryContent);

    // Append to log
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(auditEntry) + '\n', { mode: 0o600 });

    return true;
  } catch (error) {
    console.error('Failed to record audit entry:', error.message);
    return false;
  }
}

/**
 * Read all audit entries
 *
 * @returns {array} Array of audit entries
 */
function readAuditLog() {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) {
      return [];
    }

    const lines = fs
      .readFileSync(AUDIT_LOG_PATH, 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines (truncated write, corruption)
      }
    }
    return entries;
  } catch (error) {
    console.error('Failed to read audit log:', error.message);
    return [];
  }
}

/**
 * Verify audit log integrity
 * Check that all hashes form a valid chain
 *
 * @returns {object} Verification result
 */
function verifyIntegrity() {
  try {
    const entries = readAuditLog();

    if (entries.length === 0) {
      return {
        valid: true,
        entriesChecked: 0,
        integrityErrors: [],
      };
    }

    const errors = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Try new hash format (all fields) first, fall back to legacy (7 fields) for old entries
      const newContent = JSON.stringify({
        timestamp: entry.timestamp,
        version: entry.version,
        commitHash: entry.commitHash,
        filesScanned: entry.filesScanned,
        findings: entry.findings,
        findingCount: entry.findingCount,
        severityCounts: entry.severityCounts,
        userDecision: entry.userDecision,
        verification: entry.verification,
        exposure: entry.exposure,
        action: entry.action,
        actionDetails: entry.actionDetails,
        previousHash: entry.previousHash,
      });
      const legacyContent = JSON.stringify({
        timestamp: entry.timestamp,
        commitHash: entry.commitHash,
        filesScanned: entry.filesScanned,
        findings: entry.findings,
        findingCount: entry.findingCount,
        severityCounts: entry.severityCounts,
        userDecision: entry.userDecision,
        previousHash: entry.previousHash,
      });

      const newHash = calculateHash(newContent);
      const legacyHash = calculateHash(legacyContent);

      if (entry.hash !== newHash && entry.hash !== legacyHash) {
        errors.push({
          entryIndex: i,
          message: 'Hash mismatch',
          expected: newHash,
          actual: entry.hash,
        });
      }

      // Check chain linkage
      if (i > 0) {
        const previousEntry = entries[i - 1];
        if (entry.previousHash !== previousEntry.hash) {
          errors.push({
            entryIndex: i,
            message: 'Chain linkage broken',
            expected: previousEntry.hash,
            actual: entry.previousHash,
          });
        }
      } else if (entry.previousHash !== null) {
        errors.push({
          entryIndex: i,
          message: 'First entry should have no previous hash',
        });
      }
    }

    return {
      valid: errors.length === 0,
      entriesChecked: entries.length,
      integrityErrors: errors,
    };
  } catch (error) {
    return {
      valid: false,
      entriesChecked: 0,
      integrityErrors: [{ message: error.message }],
    };
  }
}

/**
 * Query audit log with filters
 *
 * @param {object} filters - Filter options
 * @returns {array} Matching entries
 */
function queryAuditLog(filters = {}) {
  const entries = readAuditLog();
  let results = entries;

  // Filter by date range
  if (filters.since) {
    const sinceDate = new Date(filters.since);
    results = results.filter(
      (entry) => new Date(entry.timestamp) >= sinceDate
    );
  }

  if (filters.until) {
    const untilDate = new Date(filters.until);
    results = results.filter(
      (entry) => new Date(entry.timestamp) <= untilDate
    );
  }

  // Filter by decision
  if (filters.decision) {
    results = results.filter((entry) => entry.userDecision === filters.decision);
  }

  // Filter by minimum findings
  if (filters.minFindings) {
    results = results.filter(
      (entry) => entry.findingCount >= filters.minFindings
    );
  }

  // Filter by severity
  if (filters.severity) {
    results = results.filter((entry) => {
      const severityCounts = entry.severityCounts || {};
      return severityCounts[filters.severity] && severityCounts[filters.severity] > 0;
    });
  }

  return results;
}

/**
 * Export audit log
 *
 * @param {string} format - Export format (json or csv)
 * @returns {string} Exported data
 */
/**
 * Sanitize a value for CSV export to prevent formula injection.
 * Prefixes dangerous characters (=, +, -, @, \t, \r) with a single quote.
 */
function sanitizeCsvCell(value) {
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function exportAuditLog(format = 'json') {
  const entries = readAuditLog();

  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  if (format === 'csv') {
    if (entries.length === 0) return '';

    // CSV header
    const headers = [
      'timestamp',
      'commitHash',
      'filesScanned',
      'findingCount',
      'criticalFindings',
      'highFindings',
      'mediumFindings',
      'lowFindings',
      'userDecision',
    ];

    let csv = headers.join(',') + '\n';

    // CSV rows
    for (const entry of entries) {
      const counts = entry.severityCounts || {};
      const row = [
        sanitizeCsvCell(entry.timestamp),
        sanitizeCsvCell(entry.commitHash),
        sanitizeCsvCell(entry.filesScanned.join(';')),
        entry.findingCount,
        counts.critical || 0,
        counts.high || 0,
        counts.medium || 0,
        counts.low || 0,
        sanitizeCsvCell(entry.userDecision || 'none'),
      ];

      csv += row.map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)).join(',') + '\n';
    }

    return csv;
  }

  return JSON.stringify(entries, null, 2);
}

/**
 * Get audit log statistics
 *
 * @returns {object} Statistics
 */
function getStatistics() {
  const entries = readAuditLog();

  const stats = {
    totalScans: entries.length,
    totalFindingsLogged: 0,
    averageBypassRate: 0,
    severityTotals: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    decisionCounts: {
      bypass: 0,
      fix: 0,
      skip: 0,
      cancel: 0,
      none: 0,
    },
  };

  for (const entry of entries) {
    stats.totalFindingsLogged += entry.findingCount || 0;

    const counts = entry.severityCounts || {};
    stats.severityTotals.critical += counts.critical || 0;
    stats.severityTotals.high += counts.high || 0;
    stats.severityTotals.medium += counts.medium || 0;
    stats.severityTotals.low += counts.low || 0;

    const decision = entry.userDecision || 'none';
    stats.decisionCounts[decision] = (stats.decisionCounts[decision] || 0) + 1;
  }

  if (stats.totalScans > 0) {
    stats.averageBypassRate =
      ((stats.decisionCounts.bypass / stats.totalScans) * 100).toFixed(2) + '%';
  }

  return stats;
}

/**
 * Clear audit log (with confirmation)
 *
 * @returns {boolean} Success
 */
function clearAuditLog() {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      fs.unlinkSync(AUDIT_LOG_PATH);
    }
    return true;
  } catch (error) {
    console.error('Failed to clear audit log:', error.message);
    return false;
  }
}

module.exports = {
  AUDIT_LOG_PATH,
  recordScan,
  readAuditLog,
  verifyIntegrity,
  queryAuditLog,
  exportAuditLog,
  getStatistics,
  clearAuditLog,
  ensureAuditDir,
};
