/**
 * Core secret scanner engine
 * Detects secrets using pattern matching and entropy analysis
 * Integrates with .gaterc config and .gateignore patterns
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPatternRules, getEntropyRule } = require('./rules');
const { loadConfig, DEFAULT_MAX_FILE_SIZE } = require('./config');
const { loadIgnorePatterns, shouldIgnoreFile, shouldIgnoreFinding, hasInlineIgnore } = require('./ignore');

/**
 * Per-file-type entropy thresholds
 * Config files use lower thresholds (secrets more likely), minified files use higher
 */
const FILE_TYPE_ENTROPY_THRESHOLDS = {
  config: 3.8,   // .env, .yml, .yaml, .ini, .cfg, .conf, .toml, .properties
  source: 4.8,   // .js, .ts, .py, .go, .rb, .java, .rs, .c, .cpp, etc.
  minified: 5.0,  // .min.js, .min.css, .bundle.js
};

const CONFIG_EXTENSIONS = new Set([
  '.env', '.yml', '.yaml', '.ini', '.cfg', '.conf', '.toml', '.properties',
  '.json', '.xml',
]);

const MINIFIED_PATTERNS = ['.min.js', '.min.css', '.bundle.js', '.bundle.css'];

/**
 * Format a byte count into a human-readable string
 *
 * @param {number} bytes - Number of bytes
 * @returns {string} Human-readable size (e.g., "4.2MB")
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '') + 'GB';
}

/**
 * Get the entropy threshold for a given file path based on its type
 *
 * @param {string} filePath - Path to the file
 * @param {number} defaultThreshold - Fallback threshold from config
 * @returns {number} Entropy threshold to use
 */
function getEntropyThresholdForFile(filePath, defaultThreshold) {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath);

  // Check for minified files first (more specific)
  for (const pattern of MINIFIED_PATTERNS) {
    if (basename.endsWith(pattern)) {
      return FILE_TYPE_ENTROPY_THRESHOLDS.minified;
    }
  }

  // Check for config files
  if (CONFIG_EXTENSIONS.has(ext)) {
    return FILE_TYPE_ENTROPY_THRESHOLDS.config;
  }

  // .env files have no extension but start with .env
  if (basename === '.env' || basename.startsWith('.env.')) {
    return FILE_TYPE_ENTROPY_THRESHOLDS.config;
  }

  // Default to source code threshold or the provided default
  return defaultThreshold || FILE_TYPE_ENTROPY_THRESHOLDS.source;
}

/**
 * Calculate Shannon entropy of a string
 * Useful for detecting random-looking strings (often secrets)
 *
 * @param {string} str - String to analyze
 * @returns {number} Entropy value (bits per character)
 */
function calculateEntropy(str) {
  if (!str || str.length === 0) return 0;

  const frequencies = {};

  // Count character frequencies
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  // Calculate entropy
  let entropy = 0;
  for (const char in frequencies) {
    const freq = frequencies[char] / str.length;
    entropy -= freq * Math.log2(freq);
  }

  return entropy;
}

/**
 * Check if a string should be scanned for high entropy
 * Avoids false positives from URLs, HTML, code, etc.
 *
 * @param {string} str - String to check
 * @returns {boolean} True if string should be entropy-scanned
 */
function shouldScanForEntropy(str) {
  // Skip very short strings (variable names, etc.)
  if (str.length < 20) return false;

  // Skip common code patterns
  if (str.startsWith('http://') || str.startsWith('https://')) return false;
  if (str.startsWith('<') && str.endsWith('>')) return false; // HTML/XML tags
  if (str.includes('<!DOCTYPE') || str.includes('<?xml')) return false;
  if (str.includes('function ') || str.includes('class ')) return false;

  // Skip template literals with interpolation (error messages, UI text, etc.)
  if (str.includes('${')) return false;

  // Skip strings that look like file paths or CLI commands
  if (str.includes('/') && (str.match(/\//g) || []).length >= 2) return false;

  // Skip strings with lots of spaces (comments, prose, etc.)
  const spaceRatio = (str.match(/ /g) || []).length / str.length;
  if (spaceRatio > 0.15) return false;

  // Skip strings that are mostly lowercase words (natural language / code identifiers)
  const wordish = str.match(/[a-z]{3,}/g);
  if (wordish && wordish.join('').length > str.length * 0.6) return false;

  return true;
}

/**
 * Scan a string for pattern matches
 *
 * @param {string} content - Content to scan
 * @param {number} lineNum - Line number for reporting
 * @param {object} options - Scanner options
 * @returns {array} Array of findings
 */
function scanForPatterns(content, lineNum, options = {}) {
  const findings = [];

  // Skip lines with inline gate-ignore comment
  if (hasInlineIgnore(content)) {
    return findings;
  }

  const rules = getPatternRules();
  const entropyRule = getEntropyRule();
  const entropyThreshold = options.entropyThreshold || 3.8;
  const customRules = options.customRules || [];

  // Pattern matching — built-in rules
  for (const rule of rules) {
    if (!rule.pattern) continue; // Skip entropy-only rules

    let match;
    const regex = new RegExp(rule.pattern.source, 'g');

    while ((match = regex.exec(content)) !== null) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        type: 'pattern',
        lineNumber: lineNum,
        match: match[0],
        matchStart: match.index,
        matchLength: match[0].length,
      });
    }
  }

  // Pattern matching — custom rules from .gaterc
  for (const rule of customRules) {
    if (!rule.pattern) continue;

    let match;
    const regex = new RegExp(rule.pattern, 'g');

    while ((match = regex.exec(content)) !== null) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        type: 'pattern',
        lineNumber: lineNum,
        match: match[0],
        matchStart: match.index,
        matchLength: match[0].length,
      });
    }
  }

  // Entropy-based detection (look for random-looking strings)
  // Simple approach: look for quoted strings and check their entropy
  const stringPattern = /['"`]([^'"`\n]{20,})['"`]/g;
  let match;

  while ((match = stringPattern.exec(content)) !== null) {
    const str = match[1];

    if (shouldScanForEntropy(str)) {
      const entropy = calculateEntropy(str);

      if (entropy >= entropyThreshold) {
        findings.push({
          ruleId: entropyRule.id,
          ruleName: entropyRule.name,
          severity: entropyRule.severity,
          type: 'entropy',
          lineNumber: lineNum,
          match: str.substring(0, 50) + (str.length > 50 ? '...' : ''),
          entropy: entropy.toFixed(2),
          matchStart: match.index,
          matchLength: match[0].length,
        });
      }
    }
  }

  return findings;
}

/**
 * Scan a single file for secrets
 *
 * @param {string} filePath - Path to file to scan
 * @param {object} options - Scanner options
 * @returns {object} Scan results for file
 */
function scanFile(filePath, options = {}) {
  const results = {
    file: filePath,
    size: 0,
    isBinary: false,
    findings: [],
    error: null,
  };

  try {
    // Check ignore patterns if provided
    if (options.ignorePatterns) {
      const relativePath = options.configDir
        ? path.relative(options.configDir, filePath)
        : filePath;
      if (shouldIgnoreFile(relativePath, options.ignorePatterns)) {
        return results;
      }
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      results.error = 'File not found';
      return results;
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    results.size = stats.size;

    // Skip files exceeding size limit to prevent OOM
    const maxFileSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    if (results.size > maxFileSize) {
      results.skipped = true;
      results.skipReason = `File size ${formatBytes(results.size)} exceeds limit ${formatBytes(maxFileSize)}`;
      return results;
    }

    // Skip binary files by default
    if (!options.scanBinary && isBinaryFile(filePath)) {
      results.isBinary = true;
      return results;
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');

    // Determine per-file-type entropy threshold
    const fileEntropyThreshold = getEntropyThresholdForFile(
      filePath,
      options.entropyThreshold
    );

    const scanOptions = {
      ...options,
      entropyThreshold: fileEntropyThreshold,
    };

    // Scan each line
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineFindings = scanForPatterns(lines[i], i + 1, scanOptions);
      results.findings.push(...lineFindings);
    }
  } catch (error) {
    results.error = error.message;
  }

  return results;
}

/**
 * Detect if file is binary
 * Check for null bytes and other binary markers in first 512 bytes
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if likely binary
 */
function isBinaryFile(filePath) {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 512);
    fs.closeSync(fd);

    // Check for null bytes and common binary markers in the read portion
    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i];
      // Null byte is a strong indicator of binary
      if (byte === 0) return true;
      // Check for control characters (except common ones like \n, \r, \t)
      if (byte < 9 || (byte > 13 && byte < 32)) {
        // Common binary markers (0x1a, 0x7f, etc.)
        if (byte === 0x1a || byte === 0x7f) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Scan multiple files
 *
 * @param {array} filePaths - Array of file paths to scan
 * @param {object} options - Scanner options
 * @returns {object} Combined scan results
 */
function scanFiles(filePaths, options = {}) {
  // Load config and ignore patterns
  const configDir = options.configDir || process.cwd();
  const config = options.config || loadConfig(configDir);
  const ignorePatterns = options.ignorePatterns || loadIgnorePatterns(configDir);

  // Build severity overrides map
  const severityOverrides = config.severity || {};

  // Merge custom rules from config
  const customRules = config.rules || [];

  // Prepare options to pass down
  const scanOptions = {
    ...options,
    ignorePatterns,
    configDir,
    customRules,
    entropyThreshold: options.entropyThreshold || config.entropy_threshold,
    maxFileSize: options.maxFileSize || config.max_file_size,
  };

  const results = {
    timestamp: new Date().toISOString(),
    filesScanned: [],
    totalFindings: 0,
    severityCounts: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };

  for (const filePath of filePaths) {
    const fileResults = scanFile(filePath, scanOptions);

    // Compute the relative path for ignore matching
    const relativePath = path.relative(configDir, filePath);

    // Post-process findings: apply severity overrides and rule-specific ignores
    fileResults.findings = fileResults.findings.filter(finding => {
      // Check rule-specific ignore patterns
      if (shouldIgnoreFinding(finding.ruleId, relativePath, ignorePatterns)) {
        return false;
      }

      // Check severity overrides — 'ignore' means suppress the finding
      const override = severityOverrides[finding.ruleId];
      if (override === 'ignore') {
        return false;
      }

      // Apply severity override (change severity but keep the finding)
      if (override && override !== 'ignore') {
        finding.severity = override;
      }

      return true;
    });

    results.filesScanned.push(fileResults);

    // Count findings by severity
    for (const finding of fileResults.findings) {
      results.totalFindings++;
      const severity = finding.severity || 'medium';
      results.severityCounts[severity]++;
    }
  }

  return results;
}

/**
 * Scan all tracked git files
 *
 * @param {object} options - Scanner options
 * @returns {object} Combined scan results
 */
function scanAll(options = {}) {
  const { execSync } = require('child_process');
  const files = execSync('git ls-files', { encoding: 'utf8' })
    .trim().split('\n').filter(f => f.length > 0);

  // Resolve file paths relative to cwd
  const cwd = process.cwd();
  const resolvedFiles = files.map(f => path.resolve(cwd, f));

  return scanFiles(resolvedFiles, options);
}

/**
 * Get staged files from git
 * Uses git diff-index to get staged changes
 *
 * @returns {array} Array of staged file paths
 */
function getStagedFiles() {
  try {
    const { execSync } = require('child_process');

    // Get list of staged files
    const output = execSync('git diff-index --cached --name-only HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    return output
      .trim()
      .split('\n')
      .filter((file) => file.length > 0);
  } catch (error) {
    // HEAD doesn't exist (first commit) — fall back to listing all staged files
    try {
      const { execSync } = require('child_process');
      const output = execSync('git ls-files --cached', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return output
        .trim()
        .split('\n')
        .filter((file) => file.length > 0);
    } catch {
      return [];
    }
  }
}

/**
 * Get current git commit hash
 *
 * @returns {string} Current commit hash or 'HEAD' if not available
 */
function getCurrentCommitHash() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'HEAD';
  }
}

module.exports = {
  calculateEntropy,
  shouldScanForEntropy,
  scanForPatterns,
  scanFile,
  scanFiles,
  scanAll,
  isBinaryFile,
  getStagedFiles,
  getCurrentCommitHash,
  getEntropyThresholdForFile,
  formatBytes,
};
