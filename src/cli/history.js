/**
 * Git History Scanner
 * Scans past commits for secrets that were previously committed.
 * Generates git-filter-repo purge scripts for cleanup.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanForPatterns } = require('./scanner');

/**
 * Run a git command in a given directory, returning stdout as a string.
 * Returns null on error (non-zero exit).
 *
 * @param {string[]} args - Git arguments (without 'git' prefix)
 * @param {string} cwd - Working directory
 * @returns {string|null}
 */
function gitExec(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/**
 * Get the list of commits to scan.
 * Format: "<hash> <ISO date> <author> <subject>"
 *
 * @param {number} n - Max number of commits to retrieve
 * @param {string} cwd - Repo working directory
 * @returns {Array<{hash, date, author, subject}>}
 */
function getCommitList(n, cwd) {
  // %H = full hash, %aI = author date ISO 8601, %ae = author email, %s = subject
  const output = gitExec(
    ['log', '--oneline', `-${n}`, '--format=%H\t%aI\t%ae\t%s'],
    cwd
  );

  if (!output || !output.trim()) return [];

  return output
    .trim()
    .split('\n')
    .map(line => {
      const [hash, date, author, ...subjectParts] = line.split('\t');
      return {
        hash: (hash || '').trim(),
        date: (date || '').trim(),
        author: (author || '').trim(),
        subject: subjectParts.join('\t').trim(),
      };
    })
    .filter(c => c.hash);
}

/**
 * Get the diff for a single commit.
 * For the first commit (no parent), use diff-tree --root.
 *
 * @param {string} hash - Commit hash
 * @param {string} cwd - Repo working directory
 * @returns {string|null}
 */
function getCommitDiff(hash, cwd) {
  // Check if commit has a parent
  const parentCheck = gitExec(['rev-parse', '--verify', `${hash}^`], cwd);

  if (parentCheck && parentCheck.trim()) {
    // Has a parent — use regular diff
    return gitExec(['diff', `${hash}^..${hash}`], cwd);
  } else {
    // No parent (root commit) — diff against empty tree
    return gitExec(['diff-tree', '--root', '-p', hash], cwd);
  }
}

/**
 * Parse a unified diff and extract added lines with their file context and line numbers.
 *
 * @param {string} diff - Raw unified diff text
 * @returns {Array<{file, lineNumber, content}>}
 */
function parseAddedLines(diff) {
  if (!diff) return [];

  const lines = diff.split('\n');
  const addedLines = [];

  let currentFile = null;
  let newLineNum = 0;
  let inBinaryDiff = false;

  for (const line of lines) {
    // Detect binary file diff — skip until next diff header
    if (line.startsWith('Binary files') && line.includes('differ')) {
      inBinaryDiff = true;
      continue;
    }

    // New file in diff — reset binary flag and track file path
    if (line.startsWith('diff --git ')) {
      inBinaryDiff = false;
      continue;
    }

    if (inBinaryDiff) continue;

    // Track new file path from +++ b/... header
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6).trim();
      continue;
    }

    // Skip --- a/... header (old file)
    if (line.startsWith('--- ')) {
      continue;
    }

    // Hunk header: @@ -old,count +new,start @@ ...
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      if (match) {
        // The hunk starts at this line number in the new file
        // We'll adjust as we process lines
        newLineNum = parseInt(match[1], 10) - 1;
      }
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      newLineNum++;
      const content = line.slice(1); // Strip leading '+'
      if (currentFile) {
        addedLines.push({
          file: currentFile,
          lineNumber: newLineNum,
          content,
        });
      }
      continue;
    }

    // Context line (not added, not removed) — advance new file line counter
    if (!line.startsWith('-') && line !== '') {
      newLineNum++;
    }
  }

  return addedLines;
}

/**
 * Calculate how many whole days ago a date was.
 *
 * @param {string} dateStr - ISO 8601 date string
 * @returns {number}
 */
function daysAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Scan the last N commits of a git repository for secrets in added lines.
 *
 * @param {number} [n=50] - Number of commits to scan
 * @param {object} [options={}] - Options
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @returns {Promise<{commitsScanned: number, findings: Array}>}
 */
async function scanHistory(n = 50, options = {}) {
  const cwd = options.cwd || process.cwd();
  const findings = [];

  const commits = getCommitList(n, cwd);

  for (const commit of commits) {
    const diff = getCommitDiff(commit.hash, cwd);
    if (!diff) continue;

    const addedLines = parseAddedLines(diff);

    for (const { file, lineNumber, content } of addedLines) {
      const matches = scanForPatterns(content, lineNumber, {
        entropyThreshold: 3.8,
      });

      for (const m of matches) {
        findings.push({
          commitHash: commit.hash.slice(0, 7),
          commitDate: commit.date,
          author: commit.author,
          subject: commit.subject,
          file,
          lineNumber: m.lineNumber,
          ruleId: m.ruleId,
          ruleName: m.ruleName,
          severity: m.severity,
          match: m.match,
          daysInHistory: daysAgo(commit.date),
        });
      }
    }
  }

  return {
    commitsScanned: commits.length,
    findings,
  };
}

/**
 * Generate a bash purge script that uses git-filter-repo to redact secrets.
 * Saves the script to .gate/purge-<date>.sh (relative to cwd).
 *
 * @param {Array} findings - Array of findings from scanHistory
 * @param {object} [options={}] - Options
 * @param {string} [options.cwd] - Working directory
 * @returns {Promise<{scriptPath: string, affectedFiles: string[], secretCount: number}>}
 */
async function generatePurgeScript(findings, options = {}) {
  const cwd = options.cwd || process.cwd();

  // Collect unique secret values
  const uniqueSecrets = [...new Set(
    findings
      .map(f => f.match)
      .filter(Boolean)
      // Strip trailing ellipsis added by entropy truncation
      .filter(m => !m.endsWith('...'))
  )];

  // Collect unique affected files
  const affectedFiles = [...new Set(findings.map(f => f.file).filter(Boolean))];

  // Ensure .gate/ directory exists with owner-only permissions
  const gateDir = path.join(cwd, '.gate');
  if (!fs.existsSync(gateDir)) {
    fs.mkdirSync(gateDir, { recursive: true, mode: 0o700 });
  }

  const now = new Date();
  const dateTag = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const scriptPath = path.join(gateDir, `purge-${dateTag}.sh`);
  const replacementsPath = path.join(gateDir, `replacements-${dateTag}.txt`);

  // Build the replacements file content for git-filter-repo --replace-text
  // Format: literal:SECRET==>literal:REDACTED_BY_GATE
  const replacementsContent = uniqueSecrets
    .map(secret => `literal:${secret}==>literal:REDACTED_BY_GATE`)
    .join('\n') + '\n';

  const script = `#!/bin/bash
# Gate Git History Purge Script
# Generated: ${now.toISOString()}
# WARNING: This will rewrite git history. All collaborators must re-clone.
# This script is generated for review — NOT auto-executed.
# Replacements file contains sensitive values — delete after use

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPLACEMENTS_FILE="\${SCRIPT_DIR}/replacements-${dateTag}.txt"

# Pre-flight checks
if ! command -v git-filter-repo &> /dev/null; then
  echo "git-filter-repo is required. Install: pip install git-filter-repo"
  exit 1
fi

if [ ! -f "\${REPLACEMENTS_FILE}" ]; then
  echo "Replacements file not found: \${REPLACEMENTS_FILE}"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working directory must be clean before purging history."
  exit 1
fi

# Replace secrets in all commits
git filter-repo --replace-text "\${REPLACEMENTS_FILE}"

# Post-purge cleanup
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force-push (REVIEW CAREFULLY before uncommenting)
# WARNING: All collaborators must re-clone after this
# git push --force-with-lease --all
# git push --force-with-lease --tags

echo "Purge complete. ${uniqueSecrets.length} secrets replaced with REDACTED_BY_GATE."
echo "All collaborators must re-clone the repository."
echo ""
echo "WARNING: Delete the replacements file now:"
echo "  rm \${REPLACEMENTS_FILE}"

# --- Alternative: BFG Repo-Cleaner ---
# Install: brew install bfg
# bfg --replace-text replacements.txt
`;

  // Write replacements file with owner-only read/write permissions
  fs.writeFileSync(replacementsPath, replacementsContent, { mode: 0o600 });
  // Write purge script with owner-only executable permissions
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  return {
    scriptPath,
    replacementsPath,
    affectedFiles,
    secretCount: uniqueSecrets.length,
  };
}

module.exports = {
  scanHistory,
  generatePurgeScript,
};
