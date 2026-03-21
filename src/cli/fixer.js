/**
 * Auto-Fix Engine — extracts secrets from source code into .env files,
 * rewrites code to use environment variable references, and manages
 * snapshots for undo.
 *
 * This is the core differentiator of Gate: no other free tool does this.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ─── Known rule ID → env var name mappings ──────────────────────────────────

const ENV_VAR_MAP = {
  'stripe-live-secret': 'STRIPE_SECRET_KEY',
  'stripe-test-secret': 'STRIPE_TEST_SECRET_KEY',
  'stripe-live-public': 'STRIPE_PUBLISHABLE_KEY',
  'stripe-live-restricted': 'STRIPE_RESTRICTED_KEY',
  'aws-access-key-id': 'AWS_ACCESS_KEY_ID',
  'aws-secret-access-key': 'AWS_SECRET_ACCESS_KEY',
  'postgres-uri': 'DATABASE_URL',
  'mongodb-uri': 'MONGODB_URI',
  'mysql-uri': 'MYSQL_URL',
  'openai-api-key': 'OPENAI_API_KEY',
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'github-pat': 'GITHUB_TOKEN',
  'github-oauth': 'GITHUB_OAUTH_TOKEN',
  'slack-bot-token': 'SLACK_BOT_TOKEN',
  'slack-webhook': 'SLACK_WEBHOOK_URL',
  'slack-user-token': 'SLACK_USER_TOKEN',
  'slack-app-token': 'SLACK_APP_TOKEN',
  'slack-signing-secret': 'SLACK_SIGNING_SECRET',
  'sendgrid-api-key': 'SENDGRID_API_KEY',
  'mailgun-api-key': 'MAILGUN_API_KEY',
  'twilio-api-key': 'TWILIO_API_KEY',
  'gcp-api-key': 'GCP_API_KEY',
  'azure-connection-string': 'AZURE_CONNECTION_STRING',
  'azure-storage-key': 'AZURE_STORAGE_KEY',
  'firebase-key': 'FIREBASE_API_KEY',
  'npm-token': 'NPM_TOKEN',
  'pypi-token': 'PYPI_TOKEN',
  'docker-token': 'DOCKER_TOKEN',
  'heroku-token': 'HEROKU_TOKEN',
  'datadog-api-key': 'DATADOG_API_KEY',
  'sentry-dsn': 'SENTRY_DSN',
  'huggingface-token': 'HUGGINGFACE_TOKEN',
  'grafana-token': 'GRAFANA_TOKEN',
  'supabase-key': 'SUPABASE_KEY',
  'vercel-token': 'VERCEL_TOKEN',
  'netlify-token': 'NETLIFY_TOKEN',
  'cloudflare-api-key': 'CLOUDFLARE_API_KEY',
  'cloudflare-api-token': 'CLOUDFLARE_API_TOKEN',
  'linear-api-key': 'LINEAR_API_KEY',
  'notion-api-key': 'NOTION_API_KEY',
  'doppler-token': 'DOPPLER_TOKEN',
  'vault-token': 'VAULT_TOKEN',
  'terraform-token': 'TERRAFORM_TOKEN',
  'clerk-secret-key': 'CLERK_SECRET_KEY',
  'resend-api-key': 'RESEND_API_KEY',
  'replicate-token': 'REPLICATE_TOKEN',
  'mistral-api-key': 'MISTRAL_API_KEY',
  'groq-api-key': 'GROQ_API_KEY',
  'cohere-api-key': 'COHERE_API_KEY',
  'gitlab-pat': 'GITLAB_TOKEN',
  'postman-api-key': 'POSTMAN_API_KEY',
  'databricks-token': 'DATABRICKS_TOKEN',
  'railway-token': 'RAILWAY_TOKEN',
  'flyio-token': 'FLY_TOKEN',
  'planetscale-token': 'PLANETSCALE_TOKEN',
  'upstash-token': 'UPSTASH_TOKEN',
  'neon-api-key': 'NEON_API_KEY',
  'turso-token': 'TURSO_TOKEN',
};

// ─── Language detection ─────────────────────────────────────────────────────

const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'javascript',
  '.tsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.java': 'java',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.tf': 'terraform',
  '.json': 'json',
};

/**
 * Detect language from file path (extension or basename).
 * @param {string} filePath
 * @returns {string}
 */
function detectLanguage(filePath) {
  const basename = path.basename(filePath);
  if (basename === 'Dockerfile' || basename.startsWith('Dockerfile.')) {
    return 'dockerfile';
  }
  const ext = path.extname(filePath);
  return LANGUAGE_MAP[ext] || 'unknown';
}

// ─── Env var name derivation ────────────────────────────────────────────────

/**
 * Derive a suitable environment variable name from rule ID and code context.
 *
 * Priority:
 *   1. Known mapping (rule ID → canonical name)
 *   2. Variable name extracted from code context
 *   3. Fallback: rule ID → SCREAMING_SNAKE_CASE
 *
 * @param {string} ruleId
 * @param {string} line - the source code line containing the secret
 * @returns {string}
 */
function deriveEnvVarName(ruleId, line) {
  // 1. Known mapping
  if (ENV_VAR_MAP[ruleId]) return ENV_VAR_MAP[ruleId];

  // 2. Try to extract variable name from code context
  const varMatch = line.match(/(?:const|let|var|export)\s+(\w+)\s*=/);
  if (varMatch) {
    return varMatch[1].replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  }

  // 3. Fallback to rule ID
  return ruleId.toUpperCase().replace(/-/g, '_');
}

// ─── Env var reference by language ──────────────────────────────────────────

/**
 * Return the env-var reference expression for a given language.
 * @param {string} language
 * @param {string} varName
 * @returns {string}
 */
function envVarRef(language, varName) {
  switch (language) {
    case 'javascript':
      return `process.env.${varName}`;
    case 'python':
      return `os.environ["${varName}"]`;
    case 'go':
      return `os.Getenv("${varName}")`;
    case 'ruby':
      return `ENV["${varName}"]`;
    case 'java':
      return `System.getenv("${varName}")`;
    case 'yaml':
      return `\${${varName}}`;
    case 'terraform':
      return `var.${varName.toLowerCase()}`;
    default:
      return `process.env.${varName}`;
  }
}

// ─── Line rewriting ─────────────────────────────────────────────────────────

/**
 * Rewrite a single line, replacing the secret value with an env var reference.
 *
 * For most languages the quoted secret (e.g. "sk_...") is replaced with the
 * unquoted reference (e.g. process.env.X).  YAML is special: quoted values
 * keep their quotes but the inner value becomes ${VAR}.
 *
 * @param {string} line
 * @param {string} secretValue - the raw secret (without surrounding quotes)
 * @param {string} ref - the env var reference expression
 * @param {string} language
 * @returns {string|null} rewritten line, or null if no replacement was possible
 */
function rewriteLine(line, secretValue, ref, language) {
  const doubleQuoted = `"${secretValue}"`;
  const singleQuoted = `'${secretValue}'`;

  if (language === 'yaml') {
    // YAML: preserve quote style, replace inner value with ${VAR}
    if (line.includes(doubleQuoted)) {
      return line.replace(doubleQuoted, `"${ref}"`);
    }
    if (line.includes(singleQuoted)) {
      return line.replace(singleQuoted, `"${ref}"`);
    }
    // Bare value
    if (line.includes(secretValue)) {
      return line.replace(secretValue, ref);
    }
    return null;
  }

  // All other languages: remove surrounding quotes
  if (line.includes(doubleQuoted)) {
    return line.replace(doubleQuoted, ref);
  }
  if (line.includes(singleQuoted)) {
    return line.replace(singleQuoted, ref);
  }
  // Bare value (terraform, dockerfile, etc.)
  if (line.includes(secretValue)) {
    return line.replace(secretValue, ref);
  }
  return null;
}

/**
 * Rewrite a Dockerfile line: ENV KEY=val → ARG KEY
 * @param {string} line
 * @param {string} secretValue
 * @returns {string|null}
 */
function rewriteDockerfileLine(line, secretValue) {
  // Match: ENV KEY=value  or  ENV KEY value
  const envMatch = line.match(/^(\s*)ENV\s+(\w+)[= ]/);
  if (envMatch) {
    return `${envMatch[1]}ARG ${envMatch[2]}`;
  }
  // Fallback: just remove the secret
  if (line.includes(secretValue)) {
    return line.replace(secretValue, '# REMOVED BY GATE');
  }
  return null;
}

// ─── Language-specific imports ──────────────────────────────────────────────

/**
 * Ensure that the necessary import for env var access exists in the file.
 * Mutates the lines array and returns whether a line was added.
 *
 * @param {string[]} lines - file lines (mutated in place)
 * @param {string} language
 * @param {string} repoDir - repo root for package.json lookup
 * @param {string} filePath - the file being fixed
 * @returns {{ added: boolean, note: string|null }}
 */
function ensureImport(lines, language, repoDir, filePath) {
  if (language === 'python') {
    const hasImport = lines.some(l => /^import\s+os\b/.test(l) || /^from\s+os\b/.test(l));
    if (!hasImport) {
      // Insert after any shebang / encoding declarations
      let insertIdx = 0;
      if (lines[0] && lines[0].startsWith('#!')) insertIdx = 1;
      if (lines[insertIdx] && /^#.*coding/.test(lines[insertIdx])) insertIdx++;
      lines.splice(insertIdx, 0, 'import os');
      return { added: true, note: null };
    }
    return { added: false, note: null };
  }

  if (language === 'go') {
    const hasOsImport = lines.some(l => /"os"/.test(l));
    if (!hasOsImport) {
      // Find the import block and add "os"
      const singleImportIdx = lines.findIndex(l => /^import\s+"/.test(l));
      const blockImportIdx = lines.findIndex(l => /^import\s*\(/.test(l));
      if (blockImportIdx !== -1) {
        // Insert inside the import block
        lines.splice(blockImportIdx + 1, 0, '\t"os"');
        return { added: true, note: null };
      } else if (singleImportIdx !== -1) {
        // Convert single import to block
        const existing = lines[singleImportIdx].match(/import\s+"([^"]+)"/);
        if (existing) {
          lines[singleImportIdx] = `import (\n\t"${existing[1]}"\n\t"os"\n)`;
          return { added: true, note: null };
        }
      } else {
        // No import statement — add after package line
        const pkgIdx = lines.findIndex(l => /^package\s+/.test(l));
        lines.splice(pkgIdx + 1, 0, '', 'import "os"');
        return { added: true, note: null };
      }
    }
    return { added: false, note: null };
  }

  if (language === 'javascript') {
    return ensureDotenvImport(lines, repoDir, filePath);
  }

  return { added: false, note: null };
}

/**
 * For JS/TS files, optionally inject dotenv require/import.
 * Only injects if dotenv is in package.json dependencies.
 *
 * @param {string[]} lines
 * @param {string} repoDir
 * @param {string} filePath
 * @returns {{ added: boolean, note: string|null }}
 */
function ensureDotenvImport(lines, repoDir, filePath) {
  // Check for package.json
  const pkgPath = path.join(repoDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { added: false, note: 'Consider adding dotenv to load .env at runtime' };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { added: false, note: null };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.dotenv) {
    return { added: false, note: 'Consider adding dotenv to load .env at runtime' };
  }

  // Already has dotenv?
  const hasDotenv = lines.some(l =>
    /require\s*\(\s*['"]dotenv/.test(l) || /import\s+['"]dotenv/.test(l)
  );
  if (hasDotenv) {
    return { added: false, note: null };
  }

  // Determine CJS vs ESM
  const isESM = pkg.type === 'module';
  const importLine = isESM
    ? "import 'dotenv/config';"
    : "require('dotenv').config();";

  // Insert at top, after any shebang or 'use strict'
  let insertIdx = 0;
  if (lines[0] && lines[0].startsWith('#!')) insertIdx = 1;
  if (lines[insertIdx] && /['"]use strict['"]/.test(lines[insertIdx])) insertIdx++;

  lines.splice(insertIdx, 0, importLine);
  return { added: true, note: null };
}

// ─── .env file management ───────────────────────────────────────────────────

/**
 * Add or update a variable in the .env file.
 *
 * @param {string} envPath - path to .env
 * @param {string} varName
 * @param {string} value
 * @returns {{ action: string, varName: string, warning?: string }}
 */
function updateEnvFile(envPath, varName, value) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const existing = lines.find(l => l.startsWith(`${varName}=`));
    if (existing) {
      const existingValue = existing.split('=').slice(1).join('=');
      if (existingValue === value) {
        return { action: 'existing', varName };
      }
      // Conflict — different value
      const newName = `${varName}_NEW`;
      content += `\n${newName}=${value}\n`;
      fs.writeFileSync(envPath, content, { mode: 0o600 });
      return { action: 'conflict', varName: newName, warning: `${varName} already exists with different value` };
    }
  } else {
    content = '# Environment variables — generated by Gate\n# Do NOT commit this file\n\n';
  }
  content += `${varName}=${value}\n`;
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  return { action: 'added', varName };
}

/**
 * Ensure .env is listed in .gitignore.
 * @param {string} repoDir
 */
function ensureGitignore(repoDir) {
  const gitignorePath = path.join(repoDir, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split('\n');
    // Check for an exact .env line (not .env.local, etc.)
    if (lines.some(l => l.trim() === '.env')) {
      return; // Already there
    }
  }
  content += (content && !content.endsWith('\n') ? '\n' : '') + '.env\n';
  fs.writeFileSync(gitignorePath, content);
}

/**
 * Create .env.example with placeholder values.
 * @param {string} repoDir
 * @param {{ varName: string }[]} envEntries
 */
function createEnvExample(repoDir, envEntries) {
  const examplePath = path.join(repoDir, '.env.example');
  let content = '# Copy to .env and fill in real values\n\n';
  const seen = new Set();
  for (const entry of envEntries) {
    const name = entry.varName.replace(/_NEW$/, '');
    if (seen.has(name)) continue;
    seen.add(name);
    content += `${name}=\n`;
  }
  fs.writeFileSync(examplePath, content);
}

// ─── Snapshot management ────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 10;

/**
 * Compute the snapshot directory for a repo.
 * @param {string} repoDir
 * @returns {string}
 */
function getSnapshotDir(repoDir) {
  const hash = crypto.createHash('sha256').update(path.resolve(repoDir)).digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.gate', 'snapshots', hash);
}

/**
 * Create a snapshot of files before modifying them.
 *
 * @param {string} repoDir
 * @param {string[]} filesToBackup - relative paths inside repoDir
 * @returns {string} path to the snapshot
 */
function createSnapshot(repoDir, filesToBackup) {
  const snapshotDir = getSnapshotDir(repoDir);
  const timestamp = Date.now().toString();
  const snapshotPath = path.join(snapshotDir, timestamp);
  fs.mkdirSync(path.join(snapshotPath, 'files'), { recursive: true, mode: 0o700 });

  const manifest = { timestamp, repoDir: path.resolve(repoDir), files: [] };

  for (const relPath of filesToBackup) {
    const fullPath = path.join(repoDir, relPath);
    // Encode the relative path into a safe filename (replace / with __)
    const safeFileName = relPath.replace(/[/\\]/g, '__');
    if (fs.existsSync(fullPath)) {
      fs.copyFileSync(fullPath, path.join(snapshotPath, 'files', safeFileName));
      manifest.files.push({ path: relPath, safeName: safeFileName, action: 'modified' });
    } else {
      manifest.files.push({ path: relPath, safeName: safeFileName, action: 'created' });
    }
  }

  fs.writeFileSync(path.join(snapshotPath, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  pruneSnapshots(snapshotDir);
  return snapshotPath;
}

/**
 * Keep only the most recent MAX_SNAPSHOTS snapshots.
 * @param {string} snapshotDir
 */
function pruneSnapshots(snapshotDir) {
  if (!fs.existsSync(snapshotDir)) return;
  const entries = fs.readdirSync(snapshotDir)
    .filter(f => fs.statSync(path.join(snapshotDir, f)).isDirectory())
    .sort((a, b) => Number(a) - Number(b)); // oldest first
  while (entries.length > MAX_SNAPSHOTS) {
    const oldest = entries.shift();
    fs.rmSync(path.join(snapshotDir, oldest), { recursive: true, force: true });
  }
}

// ─── Core fix logic ─────────────────────────────────────────────────────────

/**
 * Fix a single finding in a file.
 *
 * @param {object} finding - scanner finding object
 * @param {string} filePath - absolute path to the file
 * @param {object} options
 * @param {string} options.repoDir - repo root directory
 * @param {boolean} [options.dryRun=false] - preview mode
 * @returns {{ fixed: boolean, envEntry: object|null, note: string|null, warning: string|null, change: object|null }}
 */
function fixFinding(finding, filePath, options = {}) {
  const { repoDir, dryRun = false } = options;
  const language = detectLanguage(filePath);
  const secretValue = finding.match;

  // Derive env var name
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const lines = fileContent.split('\n');
  const lineIdx = finding.lineNumber - 1;
  const line = lines[lineIdx] || '';
  const varName = deriveEnvVarName(finding.ruleId, line);

  const result = {
    fixed: false,
    envEntry: { varName, value: secretValue },
    note: null,
    warning: null,
    change: null,
  };

  // JSON cannot inline env vars
  if (language === 'json') {
    result.note = `JSON file cannot reference env vars inline. Secret extracted to .env as ${varName} — manual migration required.`;
    result.change = { file: filePath, type: 'extract-only', varName };
    result.fixed = true; // We consider extracting to .env as "fixed"
    return result;
  }

  // Dockerfile special handling
  if (language === 'dockerfile') {
    const rewritten = rewriteDockerfileLine(line, secretValue);
    if (rewritten !== null) {
      result.change = { file: filePath, lineNumber: finding.lineNumber, before: line, after: rewritten };
      if (!dryRun) {
        lines[lineIdx] = rewritten;
        const tmpPath = filePath + '.gate-tmp';
        fs.writeFileSync(tmpPath, lines.join('\n'));
        fs.renameSync(tmpPath, filePath);
      }
      result.fixed = true;
      return result;
    }
    return result;
  }

  // Standard language rewrite
  const ref = envVarRef(language, varName);
  const rewritten = rewriteLine(line, secretValue, ref, language);

  if (rewritten !== null) {
    result.change = { file: filePath, lineNumber: finding.lineNumber, before: line, after: rewritten };
    if (!dryRun) {
      lines[lineIdx] = rewritten;
      // Ensure language imports
      const importResult = ensureImport(lines, language, repoDir, filePath);
      if (importResult.note) result.note = importResult.note;
      const tmpPath = filePath + '.gate-tmp';
      fs.writeFileSync(tmpPath, lines.join('\n'));
      fs.renameSync(tmpPath, filePath);
    }
    result.fixed = true;
  }

  return result;
}

/**
 * Fix all findings in scan results (batch mode).
 *
 * 1. Create snapshot of all files that will be modified
 * 2. For each finding, call fixFinding
 * 3. Update/create .env file
 * 4. Update .gitignore (add .env if not present)
 * 5. Create .env.example with placeholders
 * 6. Re-scan modified files to verify fix
 * 7. Return summary
 *
 * @param {object} scanResults - output from scanner.scanFiles
 * @param {object} options
 * @param {string} options.repoDir - repo root directory
 * @returns {object} summary
 */
function fixAll(scanResults, options = {}) {
  const { repoDir } = options;
  if (!repoDir) throw new Error('repoDir is required');

  const envPath = path.join(repoDir, '.env');

  // Collect all files that will be modified
  const filesToBackup = new Set();
  for (const fileResult of scanResults.filesScanned) {
    if (fileResult.findings.length > 0) {
      const relPath = path.relative(repoDir, fileResult.file);
      filesToBackup.add(relPath);
    }
  }
  // Also backup .env and .gitignore if they exist
  filesToBackup.add('.env');
  filesToBackup.add('.gitignore');
  filesToBackup.add('.env.example');

  // Create snapshot
  createSnapshot(repoDir, Array.from(filesToBackup));

  const summary = {
    fixed: 0,
    skipped: 0,
    changes: [],
    notes: [],
    warnings: [],
    envEntries: [],
    verified: false,
  };

  // Group findings by file and process bottom-up to avoid line number shifts
  for (const fileResult of scanResults.filesScanned) {
    if (fileResult.findings.length === 0) continue;

    // Sort findings by line number DESCENDING so bottom-up edits don't shift earlier line numbers
    const sortedFindings = [...fileResult.findings].sort((a, b) => b.lineNumber - a.lineNumber);

    for (const finding of sortedFindings) {
      const result = fixFinding(finding, fileResult.file, { repoDir });
      if (result.fixed) {
        summary.fixed++;
        if (result.change) summary.changes.push(result.change);
        if (result.envEntry) summary.envEntries.push(result.envEntry);
        if (result.note) summary.notes.push(result.note);
        if (result.warning) summary.warnings.push(result.warning);
      } else {
        summary.skipped++;
      }
    }
  }

  // Update .env with extracted secrets
  for (const entry of summary.envEntries) {
    const envResult = updateEnvFile(envPath, entry.varName, entry.value);
    if (envResult.warning) {
      summary.warnings.push(envResult.warning);
    }
    // Update the entry's varName if it was renamed due to conflict
    entry.varName = envResult.varName;
  }

  // Ensure .gitignore contains .env
  ensureGitignore(repoDir);

  // Create .env.example
  if (summary.envEntries.length > 0) {
    createEnvExample(repoDir, summary.envEntries);
  }

  // Verification: check that secrets are no longer in modified files
  summary.verified = true;
  for (const change of summary.changes) {
    if (!change.file) continue;
    if (!fs.existsSync(change.file)) continue;
    const content = fs.readFileSync(change.file, 'utf8');
    // Find the corresponding env entry to get the secret value
    for (const entry of summary.envEntries) {
      if (content.includes(entry.value)) {
        // JSON files are expected to still contain the value
        const lang = detectLanguage(change.file);
        if (lang !== 'json') {
          summary.verified = false;
        }
      }
    }
  }

  return summary;
}

/**
 * Preview what fixes would be applied, without writing any files.
 *
 * @param {object} scanResults
 * @param {object} options
 * @returns {object} same shape as fixAll output
 */
function dryRun(scanResults, options = {}) {
  const { repoDir } = options;
  if (!repoDir) throw new Error('repoDir is required');

  const summary = {
    fixed: 0,
    skipped: 0,
    changes: [],
    notes: [],
    warnings: [],
    envEntries: [],
    verified: false,
  };

  for (const fileResult of scanResults.filesScanned) {
    for (const finding of fileResult.findings) {
      const result = fixFinding(finding, fileResult.file, { repoDir, dryRun: true });
      if (result.fixed) {
        summary.fixed++;
        if (result.change) summary.changes.push(result.change);
        if (result.envEntry) summary.envEntries.push(result.envEntry);
        if (result.note) summary.notes.push(result.note);
        if (result.warning) summary.warnings.push(result.warning);
      } else {
        summary.skipped++;
      }
    }
  }

  return summary;
}

/**
 * Undo the most recent fix by restoring from the latest snapshot.
 *
 * @param {string} repoDir
 * @returns {{ restored: number, deleted: number, error: string|null }}
 */
function undo(repoDir) {
  const snapshotDir = getSnapshotDir(repoDir);
  if (!fs.existsSync(snapshotDir)) {
    return { restored: 0, deleted: 0, error: 'Nothing to undo — no snapshots found for this repository' };
  }

  const entries = fs.readdirSync(snapshotDir)
    .filter(f => fs.statSync(path.join(snapshotDir, f)).isDirectory())
    .sort((a, b) => Number(b) - Number(a)); // newest first

  if (entries.length === 0) {
    return { restored: 0, deleted: 0, error: 'Nothing to undo — no snapshots found for this repository' };
  }

  const latestSnapshot = path.join(snapshotDir, entries[0]);
  const manifestPath = path.join(latestSnapshot, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { restored: 0, deleted: 0, error: 'Snapshot manifest is corrupted' };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let restored = 0;
  let deleted = 0;

  for (const fileEntry of manifest.files) {
    const fullPath = path.join(repoDir, fileEntry.path);
    if (fileEntry.action === 'modified') {
      // Restore from backup
      const backupPath = path.join(latestSnapshot, 'files', fileEntry.safeName);
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, fullPath);
        restored++;
      }
    } else if (fileEntry.action === 'created') {
      // File was created by gate — delete it
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    }
  }

  // Remove the used snapshot
  fs.rmSync(latestSnapshot, { recursive: true, force: true });

  return { restored, deleted, error: null };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  fixFinding,
  fixAll,
  dryRun,
  undo,
  deriveEnvVarName,
  detectLanguage,
  // Exposed for testing only (prefixed with _)
  _getSnapshotDir: getSnapshotDir,
};
