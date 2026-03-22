#!/usr/bin/env node

/**
 * Gate v2 CLI
 * Zero-config secret scanner
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const {
  scanFiles,
  scanAll,
  getStagedFiles,
  getCurrentCommitHash,
} = require('../src/cli/scanner');
const { recordScan, readAuditLog, queryAuditLog, exportAuditLog, getStatistics, verifyIntegrity, clearAuditLog } =
  require('../src/cli/audit');
const { install, uninstall, isInstalled } = require('../src/cli/installer');
const { checkForUpdate, checkForUpdateSync, runUpdate } = require('../src/cli/updater');
const { keygen, encrypt: vaultEncrypt, decrypt: vaultDecrypt, encryptEnvFile } = require('../src/cli/vault');
const { getRemediation } = require('../src/cli/remediation');
const { loadConfig } = require('../src/cli/config');
const { loadIgnorePatterns } = require('../src/cli/ignore');
const { formatHeader, formatFinding, formatSummary, formatForCI, detectCI, shouldUseColor } = require('../src/cli/output');
const { runInit } = require('../src/cli/init');
const { getStatus, formatStatus } = require('../src/cli/status');
const { assessExposure, formatExposure } = require('../src/cli/exposure');
const { verifyFindings } = require('../src/cli/verify');
const { fixAll, dryRun, undo } = require('../src/cli/fixer');
const { promptHookAction, runInteractive } = require('../src/cli/interactive');
const { startIncidentResponse, generateIncidentReport: genIncReport } = require('../src/cli/incident');
const { generateComplianceReport, generateHTMLReport, generateSARIF, generateJSONReport } = require('../src/cli/reporter');
const { scanHistory, generatePurgeScript } = require('../src/cli/history');

const VERSION = require('../package.json').version;

// Global error handlers — prevent raw stack traces from leaking internal paths
process.on('uncaughtException', (err) => {
  console.error(`gate: unexpected error: ${err.message}`);
  if (process.env.DEBUG === '1') console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`gate: unexpected error: ${msg}`);
  if (process.env.DEBUG === '1' && reason instanceof Error) console.error(reason.stack);
  process.exit(1);
});

// Removed commands — print migration message
const REMOVED_COMMANDS = new Set(['auth', 'login', 'license', 'logout', 'worker']);

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Gate v${VERSION} — Zero-config secret scanner

Usage:
  gate                     Show status (or install hook on first run)
  gate scan [files]        Scan for secrets (default: staged files)
  gate scan --all          Scan all tracked files
  gate init                Set up Gate for this project
  gate status              Show Gate health check
  gate fix                 Auto-remediate findings
  gate vault <cmd>         Encrypt/decrypt secrets locally
  gate audit [options]     View or query audit log
  gate install             Install pre-commit hook
  gate uninstall           Remove pre-commit hook
  gate report              Generate compliance report
  gate purge               Generate git history purge script
  gate update              Check for and install updates
  gate version             Show version
  gate help                Show this help

Scan Options:
  --all                Scan all tracked files
  --staged             Scan staged files (default)
  --history <N>        Scan last N commits for secrets in history
  --verify             Verify if detected credentials are live
  --no-verify          Skip credential verification
  --interactive        Enter interactive remediation mode
  --format <fmt>       Output format: text (default), json, sarif
  --no-color           Disable colored output
  --entropy-threshold  Set entropy threshold (default: 4.8)

Fix Options:
  --dry-run            Preview what fix would do without changing files
  --undo               Revert the most recent fix

Report Options:
  --incident <id>      Generate incident report for specific incident
  --format <fmt>       Report format: markdown (default), html, json

Examples:
  npx gate                 Install hook and start protecting
  gate scan                Scan staged files before commit
  gate scan --all          Full repository scan
  gate scan --verify       Scan and check if credentials are live
  gate scan --history 50   Scan last 50 commits for secrets
  gate fix                 Auto-fix all findings (extract to .env)
  gate fix --dry-run       Preview fixes without changing files
  gate fix --undo          Revert the last fix
  gate report              Generate Markdown compliance report
  gate report --format html  Generate HTML compliance report
  gate purge               Generate purge script for git history
  gate init                Set up .gateignore for your project
  gate status              Check Gate installation health
`);
}

/**
 * Parse command-line arguments
 *
 * @returns {object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    command: null,
    files: [],
    options: {},
  };

  if (args.length === 0) {
    return parsed;
  }

  parsed.command = args[0];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        parsed.options[key] = nextArg;
        i++;
      } else {
        parsed.options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      parsed.options[arg.substring(1)] = true;
    } else {
      // Assume it's a file
      parsed.files.push(arg);
    }
  }

  return parsed;
}

/**
 * Build SARIF output from scan results
 *
 * @param {object} results - Scan results from scanFiles/scanAll
 * @param {array} allFindings - Flattened findings array
 * @returns {object} SARIF report
 */
function buildSarif(results, allFindings) {
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'gate',
          version: VERSION,
          informationUri: 'https://gate.penumbraforge.com',
          rules: [],
        },
      },
      results: allFindings.map(f => ({
        ruleId: f.ruleId,
        level: f.severity === 'critical' || f.severity === 'high' ? 'error' : 'warning',
        message: { text: f.ruleName },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: { startLine: f.lineNumber },
          },
        }],
      })),
    }],
  };
}

/**
 * Re-scan after remediation and exit with appropriate code.
 * If all findings are resolved, re-stage modified files (in pre-commit mode) and exit 0.
 */
function exitAfterRemediation(filesToScan, modifiedFiles, scanOptions, isPreCommitHook) {
  const residual = scanFiles(filesToScan, scanOptions);
  if (residual.totalFindings === 0) {
    if (isPreCommitHook && modifiedFiles.length > 0) {
      try {
        execSync(`git add ${modifiedFiles.map(f => `"${f}"`).join(' ')}`);
        console.log(`  re-staged: ${modifiedFiles.join(', ')}`);
      } catch { /* best effort */ }
    }
    console.log('');
    process.exit(0);
  } else {
    console.log(`\n  ${residual.totalFindings} finding(s) remain after remediation.\n`);
    process.exit(1);
  }
}

/**
 * Handle scan command
 *
 * @param {array} files - Files to scan (or empty for staged)
 * @param {object} options - Scanner options
 */
async function handleScan(files, options) {
  const config = loadConfig();
  const entropyThreshold = parseFloat(options['entropy-threshold']) || config.entropy_threshold;
  const outputFormat = options.format || config.output.format || 'text';
  const colorSetting = options['no-color'] ? false : config.output.color;
  const useColor = shouldUseColor(colorSetting);
  const contextLines = config.output.context_lines || 2;
  const ciPlatform = detectCI();
  const isPreCommitHook = !!process.env.GATE_PRE_COMMIT;

  // History mode: scan past commits instead of files
  if (options.history) {
    const n = parseInt(options.history) || 50;
    const historyResults = await scanHistory(n, { cwd: process.cwd() });

    if (historyResults.findings.length === 0) {
      console.log(`\n  Scanned ${historyResults.commitsScanned} commits — no secrets found.\n`);
      process.exit(0);
    }

    console.log(`\n  Scanned ${historyResults.commitsScanned} commits — ${historyResults.findings.length} secret(s) found in history:\n`);
    for (const f of historyResults.findings) {
      const age = f.daysInHistory != null ? `${f.daysInHistory}d ago` : '';
      console.log(`  ${f.commitHash}  ${f.commitDate ? f.commitDate.slice(0, 10) : ''}  ${f.file}:${f.lineNumber}`);
      console.log(`    ${f.ruleName || f.ruleId} (${f.severity}) ${age}`);
      console.log('');
    }

    process.exit(historyResults.findings.length > 0 ? 1 : 0);
  }

  // Determine files to scan
  let results;
  let filesToScan = [];
  const scanOptions = { entropyThreshold };
  if (options.all) {
    results = scanAll(scanOptions);
    filesToScan = results.filesScanned.map(f => f.file);
  } else {
    filesToScan = files.length > 0 ? files : getStagedFiles();
    if (filesToScan.length === 0) {
      console.log('No staged files to scan.');
      process.exit(0);
    }

    results = scanFiles(filesToScan, scanOptions);
  }

  // Collect all findings with file reference
  const allFindings = [];
  for (const file of results.filesScanned) {
    for (const finding of file.findings) {
      allFindings.push({
        ...finding,
        file: file.file,
      });
    }
  }

  // Attach remediation one-liner to each finding
  for (const finding of allFindings) {
    const rem = getRemediation(finding.ruleId);
    finding.remediation = rem.guide;
  }

  // Verify credentials if --verify flag or config.verify is set (not in pre-commit hooks)
  // Skip verification entirely if --no-verify is set
  if (allFindings.length > 0 && !options['no-verify'] && (options.verify || (config.verify && !isPreCommitHook))) {
    await verifyFindings(allFindings);
  }

  // Assess exposure for each finding
  for (const finding of allFindings) {
    finding.exposure = await assessExposure(finding.file, process.cwd());
  }

  // SARIF output mode — use reporter module
  if (outputFormat === 'sarif') {
    console.log(JSON.stringify(generateSARIF(results), null, 2));
    process.exit(results.totalFindings > 0 ? 1 : 0);
  }

  // JSON output mode — use reporter module
  if (outputFormat === 'json') {
    console.log(JSON.stringify(generateJSONReport(results), null, 2));
    process.exit(results.totalFindings > 0 ? 1 : 0);
  }

  // CI mode — emit annotations
  if (ciPlatform && results.totalFindings > 0) {
    for (const finding of allFindings) {
      console.log(formatForCI(finding, ciPlatform));
    }
  }

  // Text output
  if (results.totalFindings > 0) {
    // Header
    console.log(formatHeader(results.totalFindings, useColor));

    // Each finding with code context
    for (const finding of allFindings) {
      let fileLines = [];
      try {
        fileLines = fs.readFileSync(finding.file, 'utf8').split('\n');
      } catch {
        // File may not be readable — skip context
      }

      console.log(formatFinding(finding, fileLines, {
        color: useColor,
        context_lines: contextLines,
      }));
      console.log('');
    }

    // Summary
    const counts = { ...results.severityCounts, total: results.totalFindings };
    console.log(formatSummary(counts, useColor));

    // Record to audit log
    const commitHash = getCurrentCommitHash();
    recordScan({
      commitHash,
      filesScanned: results.filesScanned.map(f => f.file),
      findings: allFindings,
      severityCounts: results.severityCounts,
      userDecision: 'reported',
    });

    // If --interactive flag, jump straight to interactive mode
    if (options.interactive) {
      const interactiveResult = await runInteractive(allFindings, {
        color: useColor,
        repoDir: process.cwd(),
        context_lines: contextLines,
      });
      const modFiles = interactiveResult ? interactiveResult.modifiedFiles || [] : [];
      exitAfterRemediation(filesToScan, modFiles, scanOptions, isPreCommitHook);
    }

    // Interactive prompt (TTY only, non-CI)
    if (process.stdin.isTTY && !ciPlatform) {
      const choice = await promptHookAction(useColor);

      if (choice === 'f') {
        const freshResults = scanFiles(getStagedFiles(), scanOptions);
        if (freshResults.totalFindings === 0) {
          console.log('\n  No findings to fix.\n');
          process.exit(0);
        }
        const fixResult = fixAll(freshResults, { repoDir: process.cwd() });
        console.log(`\n  Fixed ${fixResult.fixed} finding(s).`);
        if (fixResult.warnings.length > 0) {
          for (const w of fixResult.warnings) {
            console.log(`  Warning: ${w}`);
          }
        }
        if (fixResult.notes.length > 0) {
          for (const n of fixResult.notes) {
            console.log(`  Note: ${n}`);
          }
        }

        // Re-staging after fix in pre-commit hook mode
        if (isPreCommitHook) {
          const modifiedFiles = fixResult.modifiedFiles || [];
          if (modifiedFiles.length > 0) {
            const reResults = scanFiles(modifiedFiles, scanOptions);
            if (reResults.totalFindings === 0) {
              execSync(`git add ${modifiedFiles.map(f => `"${f}"`).join(' ')}`);
              console.log(`  re-staged: ${modifiedFiles.join(', ')}`);
            } else {
              console.log(`  ${reResults.totalFindings} finding(s) remain — files not re-staged.`);
            }
          }
        }

        console.log('');
        exitAfterRemediation(filesToScan, fixResult.modifiedFiles || [], scanOptions, isPreCommitHook);
      } else if (choice === 'i') {
        const iResult = await runInteractive(allFindings, {
          color: useColor,
          repoDir: process.cwd(),
          context_lines: contextLines,
        });
        const mFiles = iResult ? iResult.modifiedFiles || [] : [];
        exitAfterRemediation(filesToScan, mFiles, scanOptions, isPreCommitHook);
      } else {
        process.exit(1);
      }
    }

    process.exit(1);
  } else {
    // No findings — clean
    const commitHash = getCurrentCommitHash();
    recordScan({
      commitHash,
      filesScanned: results.filesScanned.map(f => f.file),
      findings: [],
      severityCounts: results.severityCounts,
      userDecision: 'approved',
    });

    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    console.log(formatSummary(counts, useColor));
    process.exit(0);
  }
}

/**
 * Handle vault command — local AES-256-GCM encryption
 */
function handleVault(files, options) {
  const subcommand = files[0];

  if (!subcommand) {
    console.log('Usage: gate vault <keygen|encrypt|decrypt|env> [args]');
    console.log('');
    console.log('  gate vault keygen [--force]    Generate vault key');
    console.log('  gate vault encrypt <value>     Encrypt a value');
    console.log('  gate vault decrypt <blob>      Decrypt a vault blob');
    console.log('  gate vault env <file>          Encrypt all .env values');
    process.exit(1);
  }

  switch (subcommand) {
    case 'keygen': {
      const result = keygen(!!options.force);
      if (result.created) {
        console.log(`Vault key generated: ${result.path}`);
      } else {
        console.log(`Vault key already exists: ${result.path}`);
        console.log('  Use --force to overwrite.');
      }
      break;
    }

    case 'encrypt': {
      const value = files[1];
      if (!value) {
        console.error('Usage: gate vault encrypt <value>');
        process.exit(1);
      }
      const blob = vaultEncrypt(value);
      console.log(blob);
      break;
    }

    case 'decrypt': {
      const blob = files[1];
      if (!blob) {
        console.error('Usage: gate vault decrypt <blob>');
        process.exit(1);
      }
      try {
        const plaintext = vaultDecrypt(blob);
        console.log(plaintext);
      } catch (err) {
        console.error(`Decryption failed: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'env': {
      const filePath = files[1];
      if (!filePath) {
        console.error('Usage: gate vault env <file>');
        process.exit(1);
      }
      try {
        const result = encryptEnvFile(filePath);
        console.log(`Encrypted ${result.count} value(s) -> ${result.outputPath}`);
      } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown vault subcommand: ${subcommand}`);
      console.log('Valid subcommands: keygen, encrypt, decrypt, env');
      process.exit(1);
  }
}

/**
 * Handle install command
 */
function handleInstall() {
  const result = install();

  if (result.success) {
    console.log(`Pre-commit hook installed at ${result.hookPath}`);
    console.log('');
    console.log('The hook will run automatically before each commit.');
    console.log('Run "gate scan" to test it now.');
  } else {
    console.error(`Installation failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle uninstall command
 */
function handleUninstall() {
  const result = uninstall();

  if (result.success) {
    console.log(result.message);
  } else {
    console.error(`Uninstallation failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle init command — interactive project setup
 */
async function handleInit() {
  try {
    const result = await runInit();

    console.log('');
    if (result.hookInstalled) {
      console.log('  pre-commit hook installed');
    }
    if (result.gateignoreCreated) {
      console.log('  .gateignore created');
    }
    if (result.gitignoreUpdated) {
      console.log('  .gitignore updated (env patterns added)');
    }
    if (result.stacks.length > 0) {
      console.log(`  detected: ${result.stacks.join(', ')}`);
    }
    console.log('');
    console.log('Gate is ready. Run "gate scan" to start scanning.');
  } catch (err) {
    console.error(`Init failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle status command — health check
 */
async function handleStatus() {
  try {
    const status = await getStatus();
    const colorSetting = !(process.argv.includes('--no-color'));
    const useColor = shouldUseColor(colorSetting);
    console.log('');
    console.log(formatStatus(status, useColor));
    console.log('');
  } catch (err) {
    console.error(`Status check failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle audit command
 */
async function handleAudit(options) {
  // Clear audit log with confirmation
  if (options.clear) {
    // Count entries for the prompt
    const entries = readAuditLog();

    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`This will permanently delete your audit log (${entries.length} entries). Type "yes" to confirm: `, resolve);
      });
      rl.close();
      if (answer.trim().toLowerCase() !== 'yes') {
        console.log('Aborted.');
        return;
      }
    }

    const success = clearAuditLog();
    if (success) {
      console.log('Audit log cleared.');
    } else {
      console.error('Failed to clear audit log.');
      process.exit(1);
    }
    return;
  }

  // Show statistics
  if (options.stats) {
    const stats = getStatistics();
    console.log('\nAudit Log Statistics:');
    console.log(`  Total scans: ${stats.totalScans}`);
    console.log(`  Total findings: ${stats.totalFindingsLogged}`);
    console.log(`  Bypass rate: ${stats.averageBypassRate}`);
    console.log(`  Critical findings: ${stats.severityTotals.critical}`);
    console.log(`  High findings: ${stats.severityTotals.high}`);
    console.log(`  Medium findings: ${stats.severityTotals.medium}`);
    console.log(`  Low findings: ${stats.severityTotals.low}`);
    return;
  }

  // Verify integrity
  if (options.verify) {
    const result = verifyIntegrity();
    if (result.valid) {
      console.log(`Audit log integrity verified (${result.entriesChecked} entries checked)`);
    } else {
      console.log(`Audit log integrity check failed:`);
      for (const error of result.integrityErrors) {
        console.log(`  Entry ${error.entryIndex}: ${error.message}`);
      }
      process.exit(1);
    }
    return;
  }

  // Export audit log
  if (options.export) {
    const format = options.export || 'json';
    const exported = exportAuditLog(format);
    console.log(exported);
    return;
  }

  // Query audit log
  const filters = {};

  if (options.since) {
    // Parse relative dates (e.g. 7d, 2w, 3m) or ISO strings
    const since = options.since;
    const relMatch = since.match(/^(\d+)([dwm])$/);
    if (relMatch) {
      const num = parseInt(relMatch[1], 10);
      const unit = relMatch[2];
      const date = new Date();
      if (unit === 'd') date.setDate(date.getDate() - num);
      else if (unit === 'w') date.setDate(date.getDate() - num * 7);
      else if (unit === 'm') date.setMonth(date.getMonth() - num);
      filters.since = date.toISOString();
    } else {
      filters.since = since;
    }
  }

  if (options.until) {
    filters.until = options.until;
  }

  if (options.filter) {
    const filterStr = options.filter;
    const match = filterStr.match(/(\w+)=(\w+)/);
    if (match) {
      filters[match[1]] = match[2];
    }
  }

  const entries = queryAuditLog(filters);

  if (entries.length === 0) {
    console.log('No matching audit entries found.');
    return;
  }

  console.log(`\nAudit Log (${entries.length} entries):\n`);

  for (const entry of entries) {
    console.log(`Timestamp: ${entry.timestamp}`);
    console.log(`Commit: ${entry.commitHash}`);
    console.log(`Files scanned: ${entry.filesScanned.length}`);
    console.log(`Findings: ${entry.findingCount}`);
    console.log(`Decision: ${entry.userDecision || 'none'}`);
    console.log('---');
  }
}

/**
 * Main entry point
 */
async function main() {
  const { command, files, options } = parseArgs();

  // No args — install hook or show status (skip if running as pre-commit hook)
  if (command === null) {
    if (process.env.GATE_PRE_COMMIT) {
      // Running as hook with no command — do nothing
      return;
    }
    if (isInstalled()) {
      await handleStatus();
    } else {
      handleInstall();
    }
    return;
  }

  // Removed commands — migration message
  if (REMOVED_COMMANDS.has(command)) {
    console.log('Removed in Gate v2. Gate is now completely free — no license needed.');
    process.exit(0);
  }

  // Update check only on 'update' and 'status' commands (skip if running as pre-commit hook)
  if ((command === 'update' || command === 'status') && !process.env.GATE_PRE_COMMIT) {
    checkForUpdate(VERSION);
  }

  try {
    switch (command) {
      case 'scan':
        await handleScan(files, options);
        break;

      case 'init':
        await handleInit();
        break;

      case 'status':
        await handleStatus();
        break;

      case 'vault':
        handleVault(files, options);
        break;

      case 'install':
        handleInstall();
        break;

      case 'uninstall':
        handleUninstall();
        break;

      case 'audit':
        await handleAudit(options);
        break;

      case 'update':
        await runUpdate(VERSION);
        break;

      case 'version':
        console.log(`Gate v${VERSION}`);
        checkForUpdateSync(VERSION).then(({ available, latest }) => {
          if (available) {
            console.log(`Update available: v${VERSION} -> v${latest}`);
            console.log('Run "gate update" to install.');
          } else if (latest) {
            console.log('Up to date.');
          }
        }).catch(() => {});
        break;

      case 'fix': {
        const scanOptions = { entropyThreshold: parseFloat(options['entropy-threshold']) || undefined };
        if (options['dry-run']) {
          const fixScanResults = scanFiles(getStagedFiles(), scanOptions);
          if (fixScanResults.totalFindings === 0) {
            console.log('  No findings to fix.');
            process.exit(0);
          }
          const preview = dryRun(fixScanResults, { repoDir: process.cwd() });
          console.log(`\n  Dry run: ${preview.fixed} finding(s) would be fixed, ${preview.skipped} skipped.\n`);
          for (const change of preview.changes) {
            console.log(`  ${change.file}:${change.lineNumber}`);
            console.log(`    - ${change.before}`);
            console.log(`    + ${change.after}`);
            console.log('');
          }
          for (const note of preview.notes) {
            console.log(`  Note: ${note}`);
          }
        } else if (options.undo) {
          const undoResult = undo(process.cwd());
          if (undoResult.error) {
            console.log(`  ${undoResult.error}`);
            process.exit(1);
          }
          console.log(`  Undo complete: ${undoResult.restored} file(s) restored, ${undoResult.deleted} file(s) removed.`);
        } else {
          const fixScanResults = scanFiles(getStagedFiles(), scanOptions);
          if (fixScanResults.totalFindings === 0) {
            console.log('  No findings to fix.');
            process.exit(0);
          }
          const fixResult = fixAll(fixScanResults, { repoDir: process.cwd() });
          console.log(`\n  Fixed ${fixResult.fixed} finding(s), ${fixResult.skipped} skipped.`);
          if (fixResult.envEntries.length > 0) {
            console.log(`  Secrets extracted to .env (${fixResult.envEntries.length} entries)`);
          }
          for (const w of fixResult.warnings) {
            console.log(`  Warning: ${w}`);
          }
          for (const n of fixResult.notes) {
            console.log(`  Note: ${n}`);
          }
          if (fixResult.verified) {
            console.log('  Verified: secrets no longer appear in source files.');
          } else {
            console.log('  Warning: some secrets may still appear in source files. Please check manually.');
          }
          // Re-scan to confirm
          const recheck = scanFiles(getStagedFiles(), scanOptions);
          if (recheck.totalFindings === 0) {
            console.log('  Re-scan: clean.\n');
          } else {
            console.log(`  Re-scan: ${recheck.totalFindings} finding(s) remain.\n`);
          }
        }
        break;
      }

      case 'report': {
        if (options.incident) {
          const report = genIncReport(options.incident);
          const outPath = `gate-incident-${options.incident}.md`;
          fs.writeFileSync(outPath, report);
          console.log(`  Incident report saved to ${outPath}`);
        } else {
          const format = options.format || 'markdown';
          const auditData = { entries: readAuditLog() };
          if (format === 'json') {
            const json = generateJSONReport({ filesScanned: auditData.entries || [] });
            console.log(JSON.stringify(json, null, 2));
          } else if (format === 'html') {
            const html = generateHTMLReport(auditData);
            const outPath = `gate-report-${new Date().toISOString().slice(0, 10)}.html`;
            fs.writeFileSync(outPath, html);
            console.log(`  Report saved to ${outPath}`);
          } else {
            const md = generateComplianceReport(auditData);
            const outPath = `gate-report-${new Date().toISOString().slice(0, 10)}.md`;
            fs.writeFileSync(outPath, md);
            console.log(`  Report saved to ${outPath}`);
          }
        }
        break;
      }

      case 'purge': {
        const purgeN = parseInt(options.history) || 50;
        const historyResults = await scanHistory(purgeN, { cwd: process.cwd() });
        if (historyResults.findings.length === 0) {
          console.log('  No secrets found in git history.');
          process.exit(0);
        }
        const purgeResult = await generatePurgeScript(historyResults.findings, { cwd: process.cwd() });
        console.log(`  Purge script saved to ${purgeResult.scriptPath}`);
        console.log(`  ${purgeResult.secretCount} secret(s) in ${purgeResult.affectedFiles.length} file(s)`);
        console.log('  Review the script before running it.');
        break;
      }

      case 'serve':
        console.log('Dashboard coming in Gate v2.2 (Phase 3)');
        break;

      case 'help':
        printUsage();
        break;

      default:
        console.error(`Unknown command: "${command}"\n`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run CLI
main();
