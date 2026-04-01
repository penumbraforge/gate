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
const MAX_LINE_SCAN_LENGTH = 16 * 1024;
const LINE_SCAN_OVERLAP = 1024;
const SECRET_INDICATOR_RE = /[A-Z0-9"'`:=/_@.-]/;

function expandTargets(filePaths, options = {}) {
  const cwd = options.cwd || process.cwd();
  const configDir = options.configDir || cwd;
  const seen = new Set();
  const expanded = [];

  function addTarget(targetPath) {
    const key = path.normalize(targetPath);
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push(targetPath);
  }

  function visit(target, preserveRelative, depth = 0) {
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(cwd, target);

    if (!fs.existsSync(absoluteTarget)) {
      addTarget(target);
      return;
    }

    let stat;
    try {
      stat = fs.lstatSync(absoluteTarget);
    } catch {
      addTarget(preserveRelative ? path.relative(cwd, absoluteTarget) : absoluteTarget);
      return;
    }

    const outputPath = preserveRelative ? path.relative(cwd, absoluteTarget) : absoluteTarget;
    if (options.ignorePatterns && depth > 0) {
      const relativePath = path.relative(configDir, absoluteTarget);
      if (shouldIgnoreFile(relativePath, options.ignorePatterns)) {
        return;
      }
    }

    if (stat.isSymbolicLink()) {
      return;
    }

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absoluteTarget, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        visit(path.join(outputPath, entry.name), preserveRelative, depth + 1);
      }
      return;
    }

    addTarget(outputPath);
  }

  for (const filePath of filePaths) {
    visit(filePath, !path.isAbsolute(filePath));
  }

  return expanded;
}

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

  // Skip strings that look like file paths or URLs (but not base64 with slashes)
  if (/^\/|:\/\//.test(str) && (str.match(/\//g) || []).length >= 2) return false;

  // Skip strings with lots of spaces (comments, prose, etc.)
  const spaceRatio = (str.match(/ /g) || []).length / str.length;
  if (spaceRatio > 0.15) return false;

  // Skip strings that are mostly lowercase words (natural language / code identifiers)
  const wordish = str.match(/[a-z]{3,}/g);
  if (wordish && wordish.join('').length > str.length * 0.6) return false;

  return true;
}

// Cached compiled regexes for performance (avoids re-creating per line)
let _cachedBuiltinRegexes = null;
const _cachedCustomRegexes = new Map();

function getCachedBuiltinRegexes() {
  if (!_cachedBuiltinRegexes) {
    const rules = getPatternRules();
    _cachedBuiltinRegexes = rules
      .filter(r => r.pattern)
      .map(rule => ({
        rule,
        regex: new RegExp(rule.pattern.source, 'g'),
      }));
  }
  return _cachedBuiltinRegexes;
}

function getCachedCustomRegex(rule) {
  if (!_cachedCustomRegexes.has(rule.id)) {
    _cachedCustomRegexes.set(rule.id, new RegExp(rule.pattern, 'g'));
  }
  return _cachedCustomRegexes.get(rule.id);
}

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

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

  const entropyRule = getEntropyRule();
  const entropyThreshold = options.entropyThreshold || 3.8;
  const customRules = options.customRules || [];

  // Pattern matching — built-in rules (cached regexes)
  for (const { rule, regex } of getCachedBuiltinRegexes()) {
    regex.lastIndex = 0;
    let match;

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

  // Pattern matching — custom rules from .gaterc (cached regexes)
  for (const rule of customRules) {
    if (!rule.pattern) continue;

    const regex = getCachedCustomRegex(rule);
    regex.lastIndex = 0;
    let match;

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

  // Entropy-based detection — use backreference for matching quotes
  const stringPattern = /(['"`])([^'"`\n]{20,})\1/g;
  let match;

  while ((match = stringPattern.exec(content)) !== null) {
    const str = match[2];

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

const MULTILINE_MAX_FILE_SIZE = 500 * 1024; // 500KB
const ASSIGNMENT_CONTEXT_RE = /[=:]\s*$|(?:key|secret|password|token|credential|api[_-]?key)\s*[=:]/i;

/**
 * Extract and check multiline secret candidates
 * Detects secrets in template literals, concatenated strings, and base64 blocks
 *
 * @param {string} content - Full file content
 * @param {object} options - Scanner options
 * @returns {array} Array of multiline findings
 */
function extractMultilineStrings(content, options = {}) {
  const findings = [];
  if (content.length > MULTILINE_MAX_FILE_SIZE) return findings;

  const rules = getPatternRules();
  const entropyThreshold = options.entropyThreshold || 4.8;
  const lines = content.split('\n');

  // Helper: check a joined multiline string against rules and entropy
  function checkMultilineCandidate(joined, startLine) {
    // Check against pattern rules first
    for (const rule of rules) {
      if (!rule.pattern) continue;
      const re = new RegExp(rule.pattern.source, 'g');
      if (re.test(joined)) {
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          type: 'multiline-pattern',
          lineNumber: startLine + 1,
          match: joined.substring(0, 50) + (joined.length > 50 ? '...' : ''),
          multiline: true,
        });
        return; // One match per candidate is enough
      }
    }
    // Check entropy with assignment context
    if (joined.length >= 20 && calculateEntropy(joined) >= entropyThreshold) {
      const contextLine = startLine > 0 ? lines[startLine - 1] : '';
      if (ASSIGNMENT_CONTEXT_RE.test(contextLine)) {
        findings.push({
          ruleId: 'high-entropy-string',
          ruleName: 'High-Entropy String (multiline)',
          severity: 'medium',
          type: 'multiline-entropy',
          lineNumber: startLine + 1,
          match: joined.substring(0, 50) + '...',
          entropy: calculateEntropy(joined).toFixed(2),
          multiline: true,
        });
      }
    }
  }

  // 1. Template literals (JS/TS): content between backticks
  const templateRe = /`([^`]{20,})`/gs;
  let tmplMatch;
  while ((tmplMatch = templateRe.exec(content)) !== null) {
    const inner = tmplMatch[1].replace(/\$\{[^}]*\}/g, '');
    if (inner.length >= 20) {
      const lineNum = content.substring(0, tmplMatch.index).split('\n').length - 1;
      checkMultilineCandidate(inner, lineNum);
    }
  }

  // 2. Concatenated strings: "..." + "..." or '...' + '...'
  const concatRe = /(['"])([^'"]{4,})\1\s*\+\s*\1([^'"]{4,})\1/g;
  let concatMatch;
  while ((concatMatch = concatRe.exec(content)) !== null) {
    const joined = concatMatch[2] + concatMatch[3];
    if (joined.length >= 20) {
      const lineNum = content.substring(0, concatMatch.index).split('\n').length - 1;
      checkMultilineCandidate(joined, lineNum);
    }
  }

  // 3. Base64 blocks: 3+ consecutive lines of base64 chars
  const base64Re = /^[A-Za-z0-9+/=]{20,}$/;
  let blockStart = -1;
  let blockLines = [];

  for (let i = 0; i <= lines.length; i++) {
    const line = (i < lines.length) ? lines[i].trim() : '';
    if (base64Re.test(line)) {
      if (blockStart === -1) blockStart = i;
      blockLines.push(line);
    } else {
      if (blockLines.length >= 3) {
        const joined = blockLines.join('');
        checkMultilineCandidate(joined, blockStart);
      }
      blockStart = -1;
      blockLines = [];
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

    if (stats.isDirectory()) {
      results.error = `Cannot scan ${filePath}: Target is a directory`;
      return results;
    }

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

    // Multiline secret detection (pre-pass on full content)
    const multilineFindings = extractMultilineStrings(content, scanOptions);
    results.findings.push(...multilineFindings);

    // Scan each line. Very long single-line files can trigger pathological
    // regex performance, so scan them in bounded overlapping windows.
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineFindings = scanLineInChunks(lines[i], i + 1, scanOptions);
      results.findings.push(...lineFindings);
    }
    // Deduplicate findings — keep highest severity per (lineNumber, matchStart, matchLength)
    const dedupMap = new Map();
    for (const finding of results.findings) {
      const key = `${finding.lineNumber}:${finding.matchStart}:${finding.matchLength}`;
      const existing = dedupMap.get(key);
      if (!existing || (SEVERITY_ORDER[finding.severity] || 0) > (SEVERITY_ORDER[existing.severity] || 0)) {
        dedupMap.set(key, finding);
      }
    }
    results.findings = Array.from(dedupMap.values());

  } catch (error) {
    if (error.code === 'EACCES') {
      results.error = `Cannot read ${filePath}: Permission denied`;
    } else if (error.code === 'ENOENT') {
      results.error = `Cannot read ${filePath}: File not found`;
    } else {
      results.error = `Cannot read ${filePath}: ${error.message}`;
    }
  }

  return results;
}

/**
 * Scan a line in bounded overlapping chunks to prevent regex DoS on very long
 * minified or malformed lines while preserving absolute match offsets.
 *
 * @param {string} line - Line content
 * @param {number} lineNumber - 1-based line number
 * @param {object} options - Scanner options
 * @returns {array} Array of findings
 */
function scanLineInChunks(line, lineNumber, options = {}) {
  if (line.length <= MAX_LINE_SCAN_LENGTH) {
    return scanForPatterns(line, lineNumber, options);
  }

  const findings = [];
  const step = MAX_LINE_SCAN_LENGTH - LINE_SCAN_OVERLAP;

  for (let start = 0; start < line.length; start += step) {
    const chunk = line.slice(start, start + MAX_LINE_SCAN_LENGTH);
    if (!SECRET_INDICATOR_RE.test(chunk)) {
      if (start + MAX_LINE_SCAN_LENGTH >= line.length) {
        break;
      }
      continue;
    }
    const chunkFindings = scanForPatterns(chunk, lineNumber, options).map((finding) => ({
      ...finding,
      matchStart: typeof finding.matchStart === 'number'
        ? finding.matchStart + start
        : finding.matchStart,
    }));
    findings.push(...chunkFindings);

    if (start + MAX_LINE_SCAN_LENGTH >= line.length) {
      break;
    }
  }

  return findings;
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
    errorCount: 0,
    skippedCount: 0,
    errors: [],
    skippedFiles: [],
    severityCounts: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };

  const expandedTargets = expandTargets(filePaths, {
    cwd: options.cwd || process.cwd(),
    configDir,
    ignorePatterns,
  });

  for (let i = 0; i < expandedTargets.length; i++) {
    const filePath = expandedTargets[i];
    if (options.onProgress) {
      options.onProgress(i, expandedTargets.length, filePath);
    }
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

    if (fileResults.error) {
      results.errorCount++;
      results.errors.push({ file: fileResults.file, error: fileResults.error });
    }

    if (fileResults.skipped) {
      results.skippedCount++;
      results.skippedFiles.push({
        file: fileResults.file,
        reason: fileResults.skipReason || 'Skipped',
      });
    }

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
  extractMultilineStrings,
  scanFile,
  scanFiles,
  scanAll,
  isBinaryFile,
  getStagedFiles,
  getCurrentCommitHash,
  getEntropyThresholdForFile,
  formatBytes,
  expandTargets,
  scanLineInChunks,
};
