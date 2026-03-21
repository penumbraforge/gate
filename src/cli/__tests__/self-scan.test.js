const path = require('path');
const fs = require('fs');
const { scanFiles } = require('../scanner');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('self-scan', () => {
  test('scanning Gate own source code produces zero findings', () => {
    // Gather all JS files in src/cli/ (the scanner's own code)
    const cliDir = path.join(PROJECT_ROOT, 'src', 'cli');
    const cliFiles = fs.readdirSync(cliDir)
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(cliDir, f));

    // Also scan the CLI entry point
    const binFile = path.join(PROJECT_ROOT, 'bin', 'gate.js');
    if (fs.existsSync(binFile)) {
      cliFiles.push(binFile);
    }

    const results = scanFiles(cliFiles, {
      configDir: PROJECT_ROOT,
    });

    if (results.totalFindings > 0) {
      // Print details to help debug any regression
      for (const f of results.filesScanned) {
        for (const finding of f.findings) {
          const rel = path.relative(PROJECT_ROOT, f.file);
          console.log(
            `  FALSE POSITIVE: ${rel}:${finding.lineNumber} ` +
            `[${finding.ruleId}] ${finding.match}`
          );
        }
      }
    }

    expect(results.totalFindings).toBe(0);
  });

  test('scanning all tracked git files produces zero findings', () => {
    // This test mirrors what `gate scan --all` does.
    // It relies on .gateignore being in place at project root.
    const { execSync } = require('child_process');

    let files;
    try {
      files = execSync('git ls-files', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(f => f.length > 0)
        .map(f => path.resolve(PROJECT_ROOT, f));
    } catch {
      // Not in a git repo (e.g., CI extract) — skip
      return;
    }

    const results = scanFiles(files, {
      configDir: PROJECT_ROOT,
    });

    if (results.totalFindings > 0) {
      const summary = {};
      for (const f of results.filesScanned) {
        for (const finding of f.findings) {
          const rel = path.relative(PROJECT_ROOT, f.file);
          const key = `${rel}:${finding.lineNumber} [${finding.ruleId}]`;
          summary[key] = finding.match;
        }
      }
      console.log('  Unexpected findings:', JSON.stringify(summary, null, 2));
    }

    expect(results.totalFindings).toBe(0);
  });
});
