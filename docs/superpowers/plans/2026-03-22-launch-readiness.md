# Gate v2 Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gate bulletproof for npm publish as `@penumbraforge/gate` — fix every crash, polish every UX surface, harden every edge case.

**Architecture:** Four layers executed sequentially: (1) crash/identity fixes, (2) first-impression UX, (3) reliability hardening, (4) shipping infrastructure. Each layer is a stable checkpoint. Tests are written alongside each feature (TDD where practical).

**Tech Stack:** Pure Node.js (>=18), js-yaml, Jest 30. Zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-03-22-launch-readiness-design.md`

**Commit identity:** All commits as penumbraforge. No Co-Authored-By lines.

---

## Task 1: Package Identity Fix

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json identity fields**

```json
{
  "name": "@penumbraforge/gate",
  "repository": {
    "type": "git",
    "url": "https://github.com/penumbraforge/gate.git"
  },
  "homepage": "https://github.com/penumbraforge/gate",
  "bugs": {
    "url": "https://github.com/penumbraforge/gate/issues"
  },
  "author": "PenumbraForge",
  "publishConfig": {
    "access": "public"
  }
}
```

Keep all other fields (version, engines, files, dependencies, scripts, keywords, license, bin, main) unchanged.

- [ ] **Step 2: Verify package.json is valid JSON**

Run: `node -e "require('./package.json'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "fix: update package identity to @penumbraforge/gate"
```

---

## Task 2: File Size Guard

**Files:**
- Modify: `src/cli/scanner.js:224-285` (scanFile function)
- Modify: `src/cli/config.js:1-81` (add max_file_size to config)
- Test: `src/cli/__tests__/scanner.test.js`

- [ ] **Step 1: Write failing tests for file size guard**

Add to `src/cli/__tests__/scanner.test.js`:

```javascript
describe('file size guard', () => {
  const { scanFile } = require('../scanner');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  test('skips files exceeding max_file_size', () => {
    // Create a temp file larger than 2MB
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const bigFile = path.join(tmpDir, 'big.js');
    fs.writeFileSync(bigFile, 'x'.repeat(3 * 1024 * 1024)); // 3MB

    const result = scanFile(bigFile, { maxFileSize: 2 * 1024 * 1024 });
    expect(result.findings).toHaveLength(0);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/size/i);

    fs.unlinkSync(bigFile);
    fs.rmdirSync(tmpDir);
  });

  test('scans files under max_file_size normally', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const smallFile = path.join(tmpDir, 'small.js');
    fs.writeFileSync(smallFile, 'const key = "sk_live_abc123def456ghi789jkl012";');

    const result = scanFile(smallFile, { maxFileSize: 2 * 1024 * 1024 });
    expect(result.skipped).toBeFalsy();
    expect(result.findings.length).toBeGreaterThan(0);

    fs.unlinkSync(smallFile);
    fs.rmdirSync(tmpDir);
  });

  test('uses default 2MB when maxFileSize not specified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const bigFile = path.join(tmpDir, 'huge.js');
    fs.writeFileSync(bigFile, 'x'.repeat(3 * 1024 * 1024));

    const result = scanFile(bigFile, {});
    expect(result.skipped).toBe(true);

    fs.unlinkSync(bigFile);
    fs.rmdirSync(tmpDir);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/cli/__tests__/scanner.test.js --testNamePattern "file size guard" -v`
Expected: FAIL (skipped/skipReason properties don't exist)

- [ ] **Step 3: Add parseFileSize utility and maxFileSize to config**

In `src/cli/config.js`, add before `module.exports`:

```javascript
const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function parseFileSize(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return DEFAULT_MAX_FILE_SIZE;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb?|mb?|gb?)?$/i);
  if (!match) return DEFAULT_MAX_FILE_SIZE;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  if (unit === 'b') return num;
  if (unit === 'k' || unit === 'kb') return num * 1024;
  if (unit === 'm' || unit === 'mb') return num * 1024 * 1024;
  if (unit === 'g' || unit === 'gb') return num * 1024 * 1024 * 1024;
  return num;
}
```

Add `max_file_size` to DEFAULTS:
```javascript
const DEFAULTS = {
  // ... existing fields ...
  max_file_size: DEFAULT_MAX_FILE_SIZE,
};
```

In `loadConfig` return object, add:
```javascript
max_file_size: parseFileSize(userConfig.max_file_size) || DEFAULT_MAX_FILE_SIZE,
```

Export: `parseFileSize, DEFAULT_MAX_FILE_SIZE`

- [ ] **Step 4: Implement file size guard in scanFile**

In `src/cli/scanner.js` `scanFile()`, after the `fs.statSync` call (line 251), add:

```javascript
// File size guard — skip files over the limit to prevent OOM
const maxFileSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
if (results.size > maxFileSize) {
  results.skipped = true;
  results.skipReason = `File size ${formatBytes(results.size)} exceeds limit ${formatBytes(maxFileSize)}`;
  return results;
}
```

Add at top of scanner.js:
```javascript
const { DEFAULT_MAX_FILE_SIZE } = require('./config');
```

Add helper:
```javascript
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

In `scanFiles()`, propagate maxFileSize from config:
```javascript
const scanOptions = {
  ...options,
  // ... existing fields ...
  maxFileSize: options.maxFileSize || config.max_file_size,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/cli/__tests__/scanner.test.js --testNamePattern "file size guard" -v`
Expected: PASS

- [ ] **Step 6: Write parseFileSize tests**

Add to `src/cli/__tests__/config.test.js`:

```javascript
describe('parseFileSize', () => {
  const { parseFileSize } = require('../config');

  test('parses numeric bytes', () => {
    expect(parseFileSize(2048)).toBe(2048);
    expect(parseFileSize('2048')).toBe(2048);
  });

  test('parses KB units', () => {
    expect(parseFileSize('512KB')).toBe(512 * 1024);
    expect(parseFileSize('512kb')).toBe(512 * 1024);
    expect(parseFileSize('512K')).toBe(512 * 1024);
  });

  test('parses MB units', () => {
    expect(parseFileSize('5MB')).toBe(5 * 1024 * 1024);
    expect(parseFileSize('5mb')).toBe(5 * 1024 * 1024);
    expect(parseFileSize('5M')).toBe(5 * 1024 * 1024);
  });

  test('parses GB units', () => {
    expect(parseFileSize('1GB')).toBe(1024 * 1024 * 1024);
    expect(parseFileSize('1G')).toBe(1024 * 1024 * 1024);
  });

  test('returns default for invalid input', () => {
    expect(parseFileSize('abc')).toBe(2 * 1024 * 1024);
    expect(parseFileSize(null)).toBe(2 * 1024 * 1024);
    expect(parseFileSize(undefined)).toBe(2 * 1024 * 1024);
  });
});
```

- [ ] **Step 7: Run all config tests**

Run: `npx jest src/cli/__tests__/config.test.js -v`
Expected: PASS

- [ ] **Step 8: Add --max-file-size CLI flag to bin/gate.js**

In `bin/gate.js` `parseArgs()`, add flag parsing:
```javascript
} else if (arg === '--max-file-size') {
  options.maxFileSize = args[++i];
```

In `handleScan`, when building scanOptions, add:
```javascript
const { parseFileSize } = require('../src/cli/config');
// ...
maxFileSize: options.maxFileSize ? parseFileSize(options.maxFileSize) : config.max_file_size,
```

Also add display of skipped files in `handleScan` after the scan loop — iterate `results.filesScanned`, for any with `skipped === true`, output a dim warning if TTY:
```javascript
const skippedFiles = results.filesScanned.filter(f => f.skipped);
if (skippedFiles.length > 0 && process.stderr.isTTY) {
  for (const f of skippedFiles) {
    console.error(`  ${DIM}Skipping ${path.basename(f.file)} (${f.skipReason})${RESET}`);
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add src/cli/scanner.js src/cli/config.js bin/gate.js src/cli/__tests__/scanner.test.js src/cli/__tests__/config.test.js
git commit -m "feat: add file size guard to prevent OOM on large files"
```

---

## Task 3: Exit Code Fix

**Files:**
- Modify: `bin/gate.js:330-392` (handleScan exit paths)
- Modify: `src/cli/interactive.js:141-324` (return modified files)
- Test: `src/cli/__tests__/interactive.test.js`

- [ ] **Step 1: Modify runInteractive to return results**

In `src/cli/interactive.js`, change the `runInteractive` function to track modified files and return them. After the fix action (line 248), track the file:

```javascript
// At top of runInteractive, add:
const modifiedFiles = [];

// In the 'f' action block, after fixFinding succeeds:
if (result && result.fixed) {
  modifiedFiles.push(finding.file);
  // ... existing console.log ...
}
```

Change the end of `runInteractive` — after the summary printout, add:
```javascript
return { summary, modifiedFiles };
```

- [ ] **Step 2: Fix all three exit code paths in bin/gate.js**

In `bin/gate.js`, create a helper function before `handleScan`:

```javascript
/**
 * Re-scan files after fix/interactive and determine exit code.
 * Exit 0 if all findings resolved, exit 1 if findings remain.
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
```

**Line 337** (--interactive flag path): Replace `process.exit(1)` with:
```javascript
const interactiveResult = await runInteractive(allFindings, { /* existing options */ });
const modFiles = interactiveResult ? interactiveResult.modifiedFiles || [] : [];
exitAfterRemediation(filesToScan, modFiles, scanOptions, isPreCommitHook);
```

**Line 379** (fix path): Replace `process.exit(fixResult.fixed > 0 ? 0 : 1)` with:
```javascript
exitAfterRemediation(filesToScan, fixResult.modifiedFiles || [], scanOptions, isPreCommitHook);
```

**Line 386** (interactive from TTY prompt): Replace `process.exit(1)` with:
```javascript
const iResult = await runInteractive(allFindings, { /* existing options */ });
const mFiles = iResult ? iResult.modifiedFiles || [] : [];
exitAfterRemediation(filesToScan, mFiles, scanOptions, isPreCommitHook);
```

**Capturing `filesToScan`:** In `handleScan`, the file list is computed before scanning — either from `getStagedFiles()` (line ~220), `scanAll()` (line ~230), or specific files from args. Add a `let filesToScan = [];` at the top of `handleScan`. Assign to it wherever the file list is computed:
```javascript
// For staged mode:
const stagedFiles = getStagedFiles();
filesToScan = stagedFiles.map(f => path.resolve(process.cwd(), f));

// For --all mode:
// scanAll() handles its own file listing, so for re-scan we need the file paths:
filesToScan = execSync('git ls-files', { encoding: 'utf8' })
  .trim().split('\n').filter(f => f.length > 0)
  .map(f => path.resolve(process.cwd(), f));
```
Also capture `scanOptions` at the same scope level so `exitAfterRemediation` can use it. Define `const isPreCommitHook = !!process.env.GATE_PRE_COMMIT;` at the top of `handleScan` (it's already used later — just move it up).

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx jest src/cli/__tests__/interactive.test.js -v`
Expected: PASS (existing tests still work since return value is additive)

- [ ] **Step 4: Commit**

```bash
git add bin/gate.js src/cli/interactive.js
git commit -m "fix: correct exit codes after interactive/fix remediation"
```

---

## Task 4: Error Message Overhaul

**Files:**
- Modify: `src/cli/config.js:30-31` (YAML parse error)
- Modify: `src/cli/scanner.js:280-282` (file read error)
- Modify: `src/cli/ignore.js:56-63` (glob parse error)
- Modify: `src/cli/installer.js:155-218` (hook install error)
- Modify: `bin/gate.js:40-50` (global error handlers)
- Test: `src/cli/__tests__/config.test.js`

- [ ] **Step 1: Write failing test for config parse error**

Add to `src/cli/__tests__/config.test.js`:

```javascript
test('reports specific error for invalid YAML', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(tmpDir, '.gaterc'), 'invalid: yaml: [\nnot closed');

  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  const config = loadConfig(tmpDir);

  expect(consoleSpy).toHaveBeenCalledWith(
    expect.stringMatching(/Invalid .gaterc/)
  );
  consoleSpy.mockRestore();

  // Should still return defaults
  expect(config.entropy_threshold).toBe(4.8);

  fs.rmSync(tmpDir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/cli/__tests__/config.test.js --testNamePattern "invalid YAML" -v`
Expected: FAIL (currently silently swallows the error)

- [ ] **Step 3: Fix all error messages**

**config.js line 30-31** — replace the empty catch:
```javascript
} catch (err) {
  console.error(`gate: Invalid .gaterc: ${err.message}. Run 'gate init' to generate a valid config.`);
}
```

**scanner.js line 280-282** — make file errors visible:
```javascript
} catch (error) {
  results.error = error.message;
  if (error.code === 'EACCES') {
    results.error = `Cannot read ${filePath}: Permission denied`;
  } else if (error.code === 'ENOENT') {
    results.error = `Cannot read ${filePath}: File not found`;
  }
}
```

**ignore.js lines 56-58 and 60-62** — warn on bad patterns:
```javascript
// In ruleMatch branch:
} catch (err) {
  console.error(`gate: Invalid pattern in .gateignore: [rule:${ruleId}] ${glob} — ${err.message}. Skipping.`);
}

// In file pattern branch:
} catch (err) {
  console.error(`gate: Invalid pattern in .gateignore: ${line} — ${err.message}. Skipping.`);
}
```

**installer.js** — already has good error messages, but improve the catch at line 213:
```javascript
} catch (error) {
  return {
    success: false,
    error: `Cannot install ${hookType} hook: ${error.message}. Check .git/hooks/ permissions.`,
  };
}
```

**bin/gate.js** — add git detection. Wrap the `scanAll` / `getStagedFiles` calls with:
```javascript
try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
} catch {
  console.error("gate: Git not found or not in a git repository. Install git or use 'gate scan <file>' for direct file scanning.");
  process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/cli/__tests__/config.test.js --testNamePattern "invalid YAML" -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx jest -v`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/config.js src/cli/scanner.js src/cli/ignore.js src/cli/installer.js bin/gate.js src/cli/__tests__/config.test.js
git commit -m "fix: replace generic error messages with specific, actionable diagnostics"
```

---

## Task 5: Progress Spinner

**Files:**
- Modify: `src/cli/output.js` (add createSpinner)
- Modify: `bin/gate.js` (integrate spinner into handleScan)
- Test: `src/cli/__tests__/output.test.js`

- [ ] **Step 1: Write failing tests for spinner**

Add to `src/cli/__tests__/output.test.js`:

```javascript
describe('createSpinner', () => {
  const { createSpinner } = require('../output');

  test('exports createSpinner function', () => {
    expect(typeof createSpinner).toBe('function');
  });

  test('returns object with start, update, succeed, fail methods', () => {
    const spinner = createSpinner({ isTTY: false });
    expect(typeof spinner.start).toBe('function');
    expect(typeof spinner.update).toBe('function');
    expect(typeof spinner.succeed).toBe('function');
    expect(typeof spinner.fail).toBe('function');
  });

  test('succeed outputs checkmark and message on non-TTY', () => {
    const output = [];
    const mockStream = {
      isTTY: false,
      write: (s) => output.push(s),
    };
    const spinner = createSpinner({ stream: mockStream });
    spinner.succeed('Done in 1.2s');
    expect(output.join('')).toContain('Done in 1.2s');
  });

  test('does not write spinner frames on non-TTY', () => {
    const output = [];
    const mockStream = {
      isTTY: false,
      write: (s) => output.push(s),
    };
    const spinner = createSpinner({ stream: mockStream });
    spinner.start('Loading...');
    // Non-TTY should print the start message once, no animation
    expect(output.length).toBeLessThanOrEqual(1);
    spinner.succeed('Done');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/cli/__tests__/output.test.js --testNamePattern "createSpinner" -v`
Expected: FAIL (createSpinner doesn't exist)

- [ ] **Step 3: Implement createSpinner in output.js**

Add to `src/cli/output.js` before `module.exports`:

```javascript
const SPINNER_FRAMES = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
const SPINNER_INTERVAL = 80;

function createSpinner(options = {}) {
  const stream = options.stream || process.stderr;
  const isTTY = stream.isTTY !== undefined ? stream.isTTY : false;
  let intervalId = null;
  let frameIndex = 0;
  let currentText = '';

  function clear() {
    if (isTTY) {
      stream.write('\r\x1b[2K');
    }
  }

  function render() {
    if (!isTTY) return;
    clear();
    stream.write(`  ${CYAN}${SPINNER_FRAMES[frameIndex]}${RESET} ${currentText}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  }

  return {
    start(text) {
      currentText = text;
      if (isTTY) {
        render();
        intervalId = setInterval(render, SPINNER_INTERVAL);
      } else {
        stream.write(`  ${text}\n`);
      }
    },

    update(text) {
      currentText = text;
      if (!isTTY) return; // Don't spam non-TTY
    },

    succeed(text) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
      stream.write(`  ${isTTY ? GREEN : ''}✓${isTTY ? RESET : ''} ${text}\n`);
    },

    fail(text) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
      stream.write(`  ${isTTY ? RED : ''}✗${isTTY ? RESET : ''} ${text}\n`);
    },

    stop() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
    },
  };
}
```

Add `createSpinner` to `module.exports`.

- [ ] **Step 4: Run spinner tests**

Run: `npx jest src/cli/__tests__/output.test.js --testNamePattern "createSpinner" -v`
Expected: PASS

- [ ] **Step 5: Integrate spinner into bin/gate.js handleScan**

In `bin/gate.js`, import `createSpinner` from output.js. In `handleScan`, wrap the scan flow:

```javascript
const spinner = createSpinner();

// Before file enumeration:
spinner.start('Discovering files...');

// After getting file list:
spinner.update(`Scanning ${filePaths.length} files...`);

// During scan loop (if converting to per-file callback):
// spinner.update(`Scanning ${i}/${total} files... (${path.basename(file)})`);

// After scan:
spinner.succeed(`Scanned ${filePaths.length} files in ${elapsed}s`);
```

To get per-file progress, modify `scanFiles` in scanner.js to accept an optional `onProgress` callback:

```javascript
function scanFiles(filePaths, options = {}) {
  // ... existing setup ...
  for (let i = 0; i < filePaths.length; i++) {
    if (options.onProgress) {
      options.onProgress(i, filePaths.length, filePaths[i]);
    }
    const fileResults = scanFile(filePaths[i], scanOptions);
    // ... existing processing ...
  }
  // ...
}
```

In bin/gate.js:
```javascript
const startTime = Date.now();
const results = scanFiles(filePaths, {
  ...scanOptions,
  onProgress: (i, total, file) => {
    spinner.update(`Scanning ${i + 1}/${total} files... (${path.basename(file)})`);
  },
});
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
spinner.succeed(`Scanned ${filePaths.length} files in ${elapsed}s`);
```

- [ ] **Step 6: Run full test suite**

Run: `npx jest -v`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/cli/output.js src/cli/scanner.js bin/gate.js src/cli/__tests__/output.test.js
git commit -m "feat: add progress spinner for scan feedback"
```

---

## Task 6: First-Run Welcome Banner

**Files:**
- Modify: `src/cli/output.js` (add formatBanner)
- Modify: `bin/gate.js` (show banner on first install)
- Test: `src/cli/__tests__/output.test.js`

- [ ] **Step 1: Add formatBanner to output.js**

```javascript
function formatBanner(version, ruleCount, useColor) {
  const g = useColor ? GREEN : '';
  const b = useColor ? BOLD : '';
  const d = useColor ? DIM : '';
  const r = useColor ? RESET : '';
  const lines = [
    `${d}  ┌─────────────────────────────────────────┐${r}`,
    `${d}  │${r}  ${b}Gate v${version}${r} — secret scanner + fixer   ${d}│${r}`,
    `${d}  │${r}                                         ${d}│${r}`,
    `${d}  │${r}  ${g}✓${r} Pre-commit hook installed            ${d}│${r}`,
    `${d}  │${r}  ${g}✓${r} ${ruleCount} detection rules loaded           ${d}│${r}`,
    `${d}  │${r}  ${g}✓${r} Zero config needed                   ${d}│${r}`,
    `${d}  │${r}                                         ${d}│${r}`,
    `${d}  │${r}  Scanning your repo now...              ${d}│${r}`,
    `${d}  └─────────────────────────────────────────┘${r}`,
  ];
  return '\n' + lines.join('\n') + '\n';
}
```

Add to `module.exports`.

- [ ] **Step 2: Integrate banner in bin/gate.js**

In the main entry point where hook auto-install happens (when user runs `gate` with no args in a repo without hook), add:

```javascript
// Check for Gate's sentinel (not just any hook file — husky/lint-staged may exist)
const hookPath = getHookPath('pre-commit');
const gateWasInstalled = hookPath && fs.existsSync(hookPath) &&
  fs.readFileSync(hookPath, 'utf8').includes('Gate hook');

if (!gateWasInstalled) {
  const hookResult = install('pre-commit');
  if (hookResult.success) {
    const { RULES } = require('../src/cli/rules');
    console.log(formatBanner(VERSION, RULES.length, useColor));
  }
}
```

Import `getHookPath` from installer (already exported).

- [ ] **Step 3: Write test for formatBanner**

Add to `src/cli/__tests__/output.test.js`:

```javascript
describe('formatBanner', () => {
  const { formatBanner } = require('../output');

  test('includes version and rule count', () => {
    const banner = formatBanner('2.0.0', 281, false);
    expect(banner).toContain('Gate v2.0.0');
    expect(banner).toContain('281');
    expect(banner).toContain('Pre-commit hook installed');
  });

  test('includes box drawing characters', () => {
    const banner = formatBanner('2.0.0', 281, false);
    expect(banner).toContain('┌');
    expect(banner).toContain('└');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/cli/__tests__/output.test.js --testNamePattern "formatBanner" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/output.js bin/gate.js src/cli/__tests__/output.test.js
git commit -m "feat: add welcome banner on first-run hook install"
```

---

## Task 7: --help Flag Support

**Files:**
- Modify: `bin/gate.js` (add per-command help, --help/-h parsing)
- Test: Integration test via direct invocation

- [ ] **Step 1: Add commandHelp map to bin/gate.js**

After `printUsage()`, add:

```javascript
const COMMAND_HELP = {
  scan: `
Gate scan — detect secrets in your code

Usage:
  gate scan [files...]     Scan specific files
  gate scan --staged       Scan staged files (default)
  gate scan --all          Scan all tracked files
  gate scan --changed      Scan files changed since upstream
  gate scan --history <N>  Scan last N commits

Options:
  --verify                 Check if detected credentials are live
  --no-verify              Skip credential verification
  --interactive            Enter interactive remediation mode
  --format <fmt>           Output: text (default), json, sarif
  --no-color               Disable colored output
  --entropy-threshold <N>  Entropy threshold (default: 4.8)
  --max-file-size <size>   Max file size to scan (default: 2MB)

Examples:
  gate scan                          Scan staged files
  gate scan --all --verify           Full scan with live credential check
  gate scan --format sarif > out     SARIF output for GitHub Code Scanning
`,
  fix: `
Gate fix — auto-remediate secrets

Usage:
  gate fix                 Extract secrets to .env, rewrite source
  gate fix --dry-run       Preview changes without modifying files
  gate fix --undo          Revert the most recent fix

Supported languages: JavaScript, TypeScript, Python, Go, Ruby, Java, YAML, Terraform, JSON, Dockerfile
`,
  report: `
Gate report — generate compliance reports

Usage:
  gate report                        Markdown report (default)
  gate report --format html          HTML report with styled output
  gate report --format json          JSON report
  gate report --incident <id>        Incident-specific report

Compliance frameworks: OWASP Top 10, NIST SP 800-53, CIS Controls, SOC 2
`,
  vault: `
Gate vault — local secret encryption

Usage:
  gate vault keygen        Generate encryption key (~/.gate/vault.key)
  gate vault encrypt       Encrypt a value
  gate vault decrypt       Decrypt a value
  gate vault env           Encrypt an .env file
`,
  audit: `
Gate audit — view scan history

Usage:
  gate audit               Show recent audit log entries
  gate audit stats         Show scan statistics
  gate audit verify        Verify audit log integrity (SHA-256 chain)
  gate audit export        Export audit log to JSON
  gate audit clear         Clear audit log
`,
  install: `
Gate install/uninstall — manage git hooks

Usage:
  gate install             Install pre-commit hook
  gate install pre-push    Install pre-push hook
  gate uninstall           Remove pre-commit hook
  gate uninstall pre-push  Remove pre-push hook
`,
  init: `
Gate init — set up Gate for this project

Creates .gateignore with sensible defaults based on detected tech stack.
Updates .gitignore to exclude .env and .gate/ directory.
`,
  status: `
Gate status — health check

Shows: version, hook status, config source, ignore patterns, rule count, last scan, audit statistics.
`,
  purge: `
Gate purge — generate git history purge script

Scans git history for secrets and generates a git-filter-repo script to remove them.

Usage:
  gate purge               Generate purge script from last scan
  gate purge --history 50  Scan and generate purge for last 50 commits

WARNING: History rewriting is destructive. Back up your repo first.
`,
};
```

- [ ] **Step 2: Add --help/-h detection to parseArgs and command dispatch**

In `parseArgs()`, add `help` to the options object:
```javascript
options.help = args.includes('--help') || args.includes('-h');
```

At the top of the main function, after parsing args, before command dispatch:
```javascript
if (options.help) {
  if (command && COMMAND_HELP[command]) {
    console.log(COMMAND_HELP[command]);
  } else {
    printUsage();
  }
  process.exit(0);
}
```

Also handle `gate <command> --help` by checking for help flag in each command handler's first line (or centrally before dispatch).

- [ ] **Step 3: Test manually**

Run: `node bin/gate.js scan --help`
Expected: Shows scan-specific help

Run: `node bin/gate.js --help`
Expected: Shows full usage

Run: `node bin/gate.js fix -h`
Expected: Shows fix-specific help

- [ ] **Step 4: Commit**

```bash
git add bin/gate.js
git commit -m "feat: add --help/-h flag support for all commands"
```

---

## Task 8: Output Polish (Header, Counter, Footer)

**Files:**
- Modify: `src/cli/output.js` (add formatScanHeader, formatFindingCounter, update formatSummary)
- Modify: `bin/gate.js` (use new formatting)
- Test: `src/cli/__tests__/output.test.js`

- [ ] **Step 1: Write tests for new output functions**

Add to `src/cli/__tests__/output.test.js`:

```javascript
describe('output polish', () => {
  const { formatScanHeader, formatFindingCounter, formatSummary } = require('../output');

  test('formatScanHeader includes version and file count', () => {
    const header = formatScanHeader('2.0.0', 281, 387, false);
    expect(header).toContain('Gate v2.0.0');
    expect(header).toContain('281 rules');
    expect(header).toContain('387 files');
  });

  test('formatFindingCounter shows index and total', () => {
    const counter = formatFindingCounter(1, 7, 'critical', 'aws-secret-access-key', false);
    expect(counter).toContain('[1/7]');
    expect(counter).toContain('CRITICAL');
    expect(counter).toContain('aws-secret-access-key');
  });

  test('formatSummary includes severity breakdown and timing', () => {
    const counts = { critical: 3, high: 2, medium: 1, low: 1, total: 7 };
    const summary = formatSummary(counts, false, { fileCount: 4, elapsed: '1.2' });
    expect(summary).toContain('7 findings');
    expect(summary).toContain('4 files');
    expect(summary).toContain('3 critical');
    expect(summary).toContain('1.2s');
  });
});
```

- [ ] **Step 2: Implement new output functions**

In `src/cli/output.js`:

```javascript
function formatScanHeader(version, ruleCount, fileCount, useColor) {
  const d = useColor ? DIM : '';
  const b = useColor ? BOLD : '';
  const r = useColor ? RESET : '';
  return `\n  ${b}Gate v${version}${r} ${d}·${r} ${ruleCount} rules ${d}·${r} scanning ${fileCount} files\n`;
}

function formatFindingCounter(index, total, severity, ruleId, useColor) {
  const d = useColor ? DIM : '';
  const r = useColor ? RESET : '';
  const sev = formatSeverity(severity, useColor);
  return `  ${d}[${index}/${total}]${r} ${sev}  ${ruleId}`;
}
```

Update `formatSummary` to accept an optional third parameter `extra = {}`:
```javascript
function formatSummary(counts, useColor, extra = {}) {
  // ... existing items logic ...
  const line = useColor ? `${DIM}${'\u2500'.repeat(50)}${RESET}` : '\u2500'.repeat(50);
  parts.push(`  ${line}`);

  if (counts.total === 0) {
    const msg = extra.elapsed
      ? `no secrets found — ${extra.elapsed}s`
      : 'no secrets found';
    parts.push(`  ${useColor ? GREEN : ''}${msg}${useColor ? RESET : ''}`);
  } else {
    const fileInfo = extra.fileCount ? ` in ${extra.fileCount} files` : '';
    const timeInfo = extra.elapsed ? ` — ${extra.elapsed}s` : '';
    parts.push(`  ${counts.total} findings${fileInfo} (${items.join(', ')})${timeInfo}`);
    parts.push('');
    parts.push('  run gate fix to auto-remediate');
    parts.push('  run gate scan --interactive for guided walkthrough');
  }
  parts.push(`  ${line}`);
  return parts.join('\n');
}
```

Add `formatScanHeader`, `formatFindingCounter` to `module.exports`.

- [ ] **Step 3: Run tests**

Run: `npx jest src/cli/__tests__/output.test.js -v`
Expected: PASS

- [ ] **Step 4: Integrate into bin/gate.js**

In `handleScan`, after spinner completes and before printing findings:
```javascript
if (format === 'text' && allFindings.length > 0) {
  console.log(formatScanHeader(VERSION, RULES.length, filePaths.length, useColor));
}
```

When printing each finding, use counter:
```javascript
allFindings.forEach((finding, idx) => {
  console.log(formatFindingCounter(idx + 1, allFindings.length, finding.severity, finding.ruleId, useColor));
  console.log(formatFinding(finding, fileLines, { color: useColor, context_lines: contextLines }));
});
```

Pass extra info to formatSummary:
```javascript
console.log(formatSummary(results.severityCounts, useColor, {
  fileCount: uniqueFiles.size,
  elapsed,
}));
```

- [ ] **Step 5: Run full test suite**

Run: `npx jest -v`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/output.js bin/gate.js src/cli/__tests__/output.test.js
git commit -m "feat: add scan header, finding counter, and timing to output"
```

---

## Task 9: Glob Parser Rewrite

**Files:**
- Modify: `src/cli/ignore.js` (rewrite globToRegex, add negation support)
- Create: `src/cli/__tests__/glob.test.js`

- [ ] **Step 1: Write comprehensive glob test suite**

Create `src/cli/__tests__/glob.test.js`:

```javascript
const { globToRegex } = require('../ignore');

describe('globToRegex', () => {
  function matches(glob, path) {
    return globToRegex(glob).test(path);
  }

  // Single star
  test('* matches files in current dir only', () => {
    expect(matches('*.js', 'foo.js')).toBe(true);
    expect(matches('*.js', 'src/foo.js')).toBe(false);
  });

  // Double star with path
  test('**/*.js matches at any depth', () => {
    expect(matches('**/*.js', 'foo.js')).toBe(true);
    expect(matches('**/*.js', 'src/foo.js')).toBe(true);
    expect(matches('**/*.js', 'a/b/c/foo.js')).toBe(true);
    expect(matches('**/*.js', 'foo.ts')).toBe(false);
  });

  // Double star at end
  test('src/** matches everything under src', () => {
    expect(matches('src/**', 'src/a')).toBe(true);
    expect(matches('src/**', 'src/a/b/c')).toBe(true);
    expect(matches('src/**', 'other/a')).toBe(false);
  });

  // Double star in middle
  test('**/test/** matches paths containing test dir', () => {
    expect(matches('**/test/**', 'test/a')).toBe(true);
    expect(matches('**/test/**', 'src/test/a')).toBe(true);
    expect(matches('**/test/**', 'src/test/a/b')).toBe(true);
    expect(matches('**/test/**', 'testing/a')).toBe(false);
  });

  // Brace expansion
  test('{a,b} expands alternatives', () => {
    expect(matches('*.{js,ts}', 'foo.js')).toBe(true);
    expect(matches('*.{js,ts}', 'foo.ts')).toBe(true);
    expect(matches('*.{js,ts}', 'foo.py')).toBe(false);
  });

  // Question mark
  test('? matches single character', () => {
    expect(matches('file?.js', 'file1.js')).toBe(true);
    expect(matches('file?.js', 'file12.js')).toBe(false);
    expect(matches('file?.js', 'file/.js')).toBe(false);
  });

  // Dot escaping
  test('dots are literal', () => {
    expect(matches('*.js', 'fooXjs')).toBe(false); // dot is not wildcard
  });

  // Literal brackets
  test('brackets are literal (not character classes)', () => {
    expect(matches('[test]', '[test]')).toBe(true);
    expect(matches('[test]', 't')).toBe(false);
  });

  // Directory trailing slash
  test('trailing slash matches directory-like paths', () => {
    const re = globToRegex('dir/');
    expect(re.test('dir')).toBe(true);
    expect(re.test('dir/sub')).toBe(true);
  });

  // Complex patterns
  test('file.*.js matches file.test.js', () => {
    expect(matches('file.*.js', 'file.test.js')).toBe(true);
    expect(matches('file.*.js', 'file.spec.js')).toBe(true);
    expect(matches('file.*.js', 'file.js')).toBe(false);
  });

  // Regex special chars
  test('special regex chars are escaped', () => {
    expect(matches('foo+bar.js', 'foo+bar.js')).toBe(true);
    expect(matches('foo(1).js', 'foo(1).js')).toBe(true);
    expect(matches('file$.txt', 'file$.txt')).toBe(true);
  });

  // Double star alone
  test('** alone matches everything', () => {
    expect(matches('**', 'anything')).toBe(true);
    expect(matches('**', 'a/b/c')).toBe(true);
  });

  // Edge: empty string
  test('empty pattern matches empty string', () => {
    expect(globToRegex('').test('')).toBe(true);
  });

  // Real-world .gateignore patterns
  test('node_modules/** matches deeply nested', () => {
    expect(matches('node_modules/**', 'node_modules/express/index.js')).toBe(true);
  });

  test('src/cli/__tests__/** matches test files', () => {
    expect(matches('src/cli/__tests__/**', 'src/cli/__tests__/scanner.test.js')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail with current implementation**

Run: `npx jest src/cli/__tests__/glob.test.js -v`
Expected: Multiple failures (especially `**/*.js`, braces, brackets)

- [ ] **Step 3: Rewrite globToRegex**

Replace the `globToRegex` function in `src/cli/ignore.js`:

```javascript
function globToRegex(glob) {
  // Handle trailing slash (directory match)
  let isDir = false;
  if (glob.endsWith('/')) {
    isDir = true;
    glob = glob.slice(0, -1);
  }

  let regex = '^';
  let i = 0;

  while (i < glob.length) {
    const c = glob[i];

    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** — match zero or more path segments
        if (glob[i + 2] === '/') {
          // **/  — zero or more directories
          regex += '(?:.+/)?';
          i += 3;
        } else if (i === 0 || glob[i - 1] === '/') {
          // ** at start or after /  — match everything
          regex += '.*';
          i += 2;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * — match any non-separator characters
        regex += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (c === '{') {
      // Brace expansion {a,b,c}
      const close = glob.indexOf('}', i);
      if (close === -1) {
        regex += '\\{';
        i++;
      } else {
        const alternatives = glob.slice(i + 1, close).split(',');
        regex += '(?:' + alternatives.map(a => a.replace(/[.*+?^$|()\\]/g, '\\$&')).join('|') + ')';
        i = close + 1;
      }
    } else if ('.()[]{}+^$|\\'.includes(c)) {
      // Escape regex special characters
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }

  if (isDir) {
    // Directory match: match the dir itself and anything under it
    regex += '(?:/.*)?';
  }

  regex += '$';
  return new RegExp(regex);
}
```

- [ ] **Step 4: Add negation support to loadIgnorePatterns and shouldIgnoreFile**

In `loadIgnorePatterns`, handle `!` prefix:

```javascript
// In the line parsing loop, before the ruleMatch check:
if (line.startsWith('!')) {
  const negGlob = line.slice(1).trim();
  if (negGlob) {
    try {
      result.negationPatterns = result.negationPatterns || [];
      result.negationPatterns.push(globToRegex(negGlob));
    } catch (err) {
      console.error(`gate: Invalid negation pattern in .gateignore: ${line} — ${err.message}. Skipping.`);
    }
  }
  continue;
}
```

In `shouldIgnoreFile`, check negations:

```javascript
function shouldIgnoreFile(filePath, patterns) {
  // Check negation patterns first — if any match, don't ignore
  if (patterns.negationPatterns) {
    for (const regex of patterns.negationPatterns) {
      if (regex.test(filePath)) return false;
    }
  }
  for (const regex of patterns.filePatterns) {
    if (regex.test(filePath)) return true;
  }
  return false;
}
```

Initialize `negationPatterns` in `loadIgnorePatterns` result:
```javascript
const result = { filePatterns: [], rulePatterns: [], negationPatterns: [] };
```

- [ ] **Step 5: Run glob tests**

Run: `npx jest src/cli/__tests__/glob.test.js -v`
Expected: All PASS

- [ ] **Step 6: Run ignore tests to verify no regressions**

Run: `npx jest src/cli/__tests__/ignore.test.js -v`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npx jest -v`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/cli/ignore.js src/cli/__tests__/glob.test.js
git commit -m "feat: rewrite glob parser with correct semantics, negation, braces"
```

---

## Task 10: Custom Rule Validation Warnings

**Files:**
- Modify: `src/cli/config.js:36-51` (add warnings)
- Test: `src/cli/__tests__/config.test.js`

- [ ] **Step 1: Write failing test**

```javascript
test('warns on custom rule with invalid regex', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(tmpDir, '.gaterc'), `
rules:
  - id: bad-rule
    pattern: "[invalid(regex"
    severity: high
  - id: good-rule
    pattern: "MYSECRET_[A-Z0-9]{32}"
    severity: high
`);

  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  const config = loadConfig(tmpDir);

  expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/bad-rule.*invalid regex/));
  expect(config.rules).toHaveLength(1);
  expect(config.rules[0].id).toBe('good-rule');

  consoleSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true });
});

test('warns on custom rule missing required fields', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(tmpDir, '.gaterc'), `
rules:
  - pattern: "SECRET_[A-Z]+"
    severity: high
  - id: no-pattern-rule
    severity: high
`);

  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  const config = loadConfig(tmpDir);

  expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/missing 'id'/));
  expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/missing 'pattern'/));
  expect(config.rules).toHaveLength(0);

  consoleSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/cli/__tests__/config.test.js --testNamePattern "warns on" -v`
Expected: FAIL

- [ ] **Step 3: Add warnings to config.js**

Replace the custom rules loop in `loadConfig`:

```javascript
const customRules = [];
if (Array.isArray(userConfig.rules)) {
  for (let idx = 0; idx < userConfig.rules.length; idx++) {
    const rule = userConfig.rules[idx];
    if (!rule.id) {
      console.error(`gate: Custom rule at index ${idx}: missing 'id' field. Skipping.`);
      continue;
    }
    if (!rule.pattern) {
      console.error(`gate: Custom rule '${rule.id}': missing 'pattern' field. Skipping.`);
      continue;
    }
    try {
      new RegExp(rule.pattern);
      customRules.push({
        id: rule.id,
        name: rule.name || rule.id,
        pattern: rule.pattern,
        severity: rule.severity || 'medium',
        remediation: rule.remediation || null,
      });
    } catch (err) {
      console.error(`gate: Custom rule '${rule.id}': invalid regex — ${err.message}. Skipping.`);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/cli/__tests__/config.test.js --testNamePattern "warns on" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.js src/cli/__tests__/config.test.js
git commit -m "feat: warn on invalid custom rules instead of silently skipping"
```

---

## Task 11: Hook Robustness (Node Resolution Chain)

**Files:**
- Modify: `src/cli/installer.js:77-125` (hook template)
- Test: `src/cli/__tests__/installer.test.js`

- [ ] **Step 1: Write test that hook template contains resolution chain**

Add to `src/cli/__tests__/installer.test.js`:

```javascript
test('hook template contains Node resolution chain', () => {
  const { generateHookSection } = require('../installer');
  const section = generateHookSection('pre-commit');

  expect(section).toContain('GATE_NODE_PATH');
  expect(section).toContain('nvm');
  expect(section).toContain('.fnm');
  expect(section).toContain('.volta');
  expect(section).toContain('/opt/homebrew/bin/node');
  expect(section).toContain('Node.js not found');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/cli/__tests__/installer.test.js --testNamePattern "resolution chain" -v`
Expected: FAIL

- [ ] **Step 3: Rewrite the Node detection in generateHookSection**

In `src/cli/installer.js` `generateHookSection`, replace the `command -v node` block (lines 96-100) with:

```javascript
return `${GATE_SECTION_START}
# Gate ${hookType} hook
# ${description}
# Set GATE_SKIP=1 to bypass (for trusted commits of source code that handles secrets)

if [ "$GATE_SKIP" = "1" ]; then
  echo "Gate scan skipped (GATE_SKIP=1)"
  exit 0
fi

export GATE_PRE_COMMIT=1

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
REPO_DIR="$(cd "$HOOK_DIR/../.." && pwd)"

if [ -f "$REPO_DIR/bin/gate.js" ]; then
  GATE_BIN="$GATE_NODE $REPO_DIR/bin/gate.js"
elif [ -f "$REPO_DIR/node_modules/.bin/gate" ]; then
  GATE_BIN="$REPO_DIR/node_modules/.bin/gate"
elif [ -f "$HOME/.gate/bin/gate" ]; then
  GATE_BIN="$HOME/.gate/bin/gate"
elif command -v gate >/dev/null 2>&1; then
  GATE_BIN="gate"
else
  echo "Gate not found. Run 'gate install' to set up the hook."
  exit 0
fi

# Run gate scan
$GATE_BIN scan ${scanArgs}

exit $?
${GATE_SECTION_END}`;
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/cli/__tests__/installer.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer.js src/cli/__tests__/installer.test.js
git commit -m "feat: robust Node.js resolution in git hooks (nvm, fnm, volta, GATE_NODE_PATH)"
```

---

## Task 12: Pre-Push Scope (--changed flag)

**Files:**
- Modify: `bin/gate.js` (add --changed flag handling)
- Modify: `src/cli/installer.js:77-79` (change pre-push template)
- Modify: `src/cli/config.js` (add hooks.pre_push_scope)
- Test: `src/cli/__tests__/installer.test.js`

- [ ] **Step 1: Add --changed parsing in bin/gate.js**

In `parseArgs`, add `changed` to options:
```javascript
} else if (arg === '--changed') {
  options.changed = true;
```

In `handleScan`, add file resolution for --changed before the existing staged/all logic:

```javascript
if (options.changed) {
  try {
    const changedOutput = execSync('git diff --name-only @{upstream}...HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    filePaths = changedOutput.split('\n').filter(f => f.length > 0)
      .map(f => path.resolve(process.cwd(), f));
  } catch {
    // No upstream or not a git repo — fall back to --all
    filePaths = null; // will trigger scanAll below
  }
}
```

- [ ] **Step 2: Add hooks.pre_push_scope config key**

In `src/cli/config.js`, add to DEFAULTS:
```javascript
hooks: {
  pre_push_scope: 'changed', // 'changed' | 'all'
},
```

In `loadConfig` return object, add:
```javascript
hooks: {
  ...DEFAULTS.hooks,
  ...(userConfig.hooks && typeof userConfig.hooks === 'object' ? userConfig.hooks : {}),
},
```

- [ ] **Step 3: Update pre-push hook template in installer.js**

Change the `generateHookSection` function to accept a config parameter:
```javascript
function generateHookSection(hookType, options = {}) {
  const isPush = hookType === 'pre-push';
  const pushScope = options.prePushScope || 'changed';
  const scanArgs = isPush ? `--${pushScope}` : '--staged';
```

Update the `install` function to load config and pass the scope:
```javascript
const { loadConfig } = require('./config');
// ... in install():
const config = loadConfig(cwd);
const prePushScope = config.hooks?.pre_push_scope || 'changed';
const gateSection = generateHookSection(hookType, { prePushScope });
```

- [ ] **Step 3: Write test**

Add to `src/cli/__tests__/installer.test.js`:

```javascript
test('pre-push hook uses --changed flag', () => {
  const { generateHookSection } = require('../installer');
  const section = generateHookSection('pre-push');
  expect(section).toContain('scan --changed');
  expect(section).not.toContain('scan --all');
});

test('pre-commit hook still uses --staged flag', () => {
  const { generateHookSection } = require('../installer');
  const section = generateHookSection('pre-commit');
  expect(section).toContain('scan --staged');
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/cli/__tests__/installer.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bin/gate.js src/cli/installer.js src/cli/__tests__/installer.test.js
git commit -m "feat: add --changed flag for pre-push scope, scan only upstream diff"
```

---

## Task 13: Multiline Secret Detection

**Files:**
- Modify: `src/cli/scanner.js` (add extractMultilineStrings)
- Test: `src/cli/__tests__/scanner.test.js`

- [ ] **Step 1: Write failing tests**

Add to `src/cli/__tests__/scanner.test.js`:

```javascript
describe('multiline secret detection', () => {
  const { scanFile } = require('../scanner');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  function scanContent(content, filename = 'test.js') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content);
    const result = scanFile(filePath, {});
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
    return result;
  }

  test('detects base64 blocks spanning multiple lines', () => {
    const content = `const key = \`
AKIAIOSFODNN7EXAMPLE
abcdefghijklmnopqrstuvwxyz012345678901234567
abcdefghijklmnopqrstuvwxyz012345678901234567
\`;`;
    const result = scanContent(content);
    // Should catch the AKIA pattern at minimum
    expect(result.findings.some(f => f.ruleId === 'aws-access-key-id')).toBe(true);
  });

  test('detects secret in template literal', () => {
    const content = 'const key = `sk_live_abcdefghijklmnopqrstuvwxyz`;';
    const result = scanContent(content);
    expect(result.findings.some(f => f.ruleId === 'stripe-live-secret')).toBe(true);
  });

  test('detects concatenated secret strings', () => {
    const content = `const key = "AKIA" + "IOSFODNN7EXAMPLE";`;
    const result = scanContent(content);
    // The AKIA prefix should be caught by pattern matching on the joined string
    expect(result.findings.some(f => f.ruleId === 'aws-access-key-id')).toBe(true);
  });

  test('does not flag normal template literals', () => {
    const content = 'const msg = `Hello world, this is a normal template string with no secrets`;';
    const result = scanContent(content);
    // Should not produce multiline-type findings (line-by-line may produce entropy findings, that's OK)
    expect(result.findings.filter(f => f.multiline)).toHaveLength(0);
  });

  test('does not flag normal string concatenation', () => {
    const content = `const msg = "Hello " + "world";`;
    const result = scanContent(content);
    expect(result.findings).toHaveLength(0);
  });

  test('skips multiline extraction on large files', () => {
    // Create file over 500KB
    const content = 'x'.repeat(600 * 1024);
    const result = scanContent(content);
    // Should not crash, should return normally
    expect(result.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to see current behavior**

Run: `npx jest src/cli/__tests__/scanner.test.js --testNamePattern "multiline" -v`
Expected: Some may pass (AKIA on single line in template literal), some may fail

- [ ] **Step 3: Implement extractMultilineStrings**

Add to `src/cli/scanner.js` before `scanFile`:

```javascript
const MULTILINE_MAX_FILE_SIZE = 500 * 1024; // 500KB
const ASSIGNMENT_CONTEXT_RE = /[=:]\s*$|(?:key|secret|password|token|credential|api[_-]?key)\s*[=:]/i;

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
        return;
      }
    }
    // Check entropy with assignment context
    if (calculateEntropy(joined) >= entropyThreshold) {
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
    // Strip ${...} interpolations, keep the rest
    const inner = tmplMatch[1].replace(/\$\{[^}]*\}/g, '');
    if (inner.length >= 20) {
      const lineNum = content.substring(0, tmplMatch.index).split('\n').length - 1;
      checkMultilineCandidate(inner, lineNum);
    }
  }

  // 2. Concatenated strings: "..." + "..." or '...' + '...'
  const concatRe = /(['"])([^'"]{8,})\1\s*\+\s*\1([^'"]{8,})\1/g;
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
```

- [ ] **Step 4: Integrate into scanFile**

In `scanFile`, after reading content and before the line-by-line scan:

```javascript
// Multiline secret detection (pre-pass on full content)
const multilineFindings = extractMultilineStrings(content, scanOptions);
results.findings.push(...multilineFindings);
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/cli/__tests__/scanner.test.js --testNamePattern "multiline" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/scanner.js src/cli/__tests__/scanner.test.js
git commit -m "feat: detect multiline secrets (base64 blocks, template literals)"
```

---

## Task 14: Interactive Mode Pagination

**Files:**
- Modify: `src/cli/interactive.js` (add navigation, batch quit)
- Test: `src/cli/__tests__/interactive.test.js`

**IMPORTANT**: Task 3 added `modifiedFiles` tracking and `return { summary, modifiedFiles }` to `runInteractive`. This task's refactor MUST preserve that return value. Every code path through the function must end with `return { summary, modifiedFiles }`.

- [ ] **Step 1: Add navigation support to runInteractive**

Refactor `runInteractive` to use an index-based loop with back/jump support:

```javascript
async function runInteractive(findings, options = {}) {
  const useColor = options.color === true;
  const repoDir  = options.repoDir || process.cwd();

  const summary = { fixed: 0, ignored: 0, vaulted: 0, skipped: 0, responded: 0 };
  const modifiedFiles = [];
  const actions = new Map(); // track action per finding index

  let i = 0;
  while (i < findings.length) {
    const finding = findings[i];

    // Header with navigation context
    console.log('');
    console.log(c(useColor, DIM, '\u2500'.repeat(60)));
    console.log(
      `  ${c(useColor, BOLD, `Finding ${i + 1} of ${findings.length}`)}` +
      `  ${c(useColor, DIM, finding.ruleName || finding.ruleId)}`
    );
    // ... existing code context and exposure ...
```

Add `p` (previous) and `j` (jump) to the valid keys arrays:

For non-PUSHED findings: `['f', 'v', 'i', 's', 'p', 'j', '?']`
For PUSHED findings: `['r', 'f', 's', 'p', 'j', '?']`

Add handlers:
```javascript
} else if (action === 'p') {
  if (i > 0) i--;
  continue;
} else if (action === 'j') {
  // Prompt for jump target
  process.stdout.write(`  Jump to [1-${findings.length}]: `);
  // Read number input (simple readline)
  const target = await readLineInput();
  const num = parseInt(target, 10);
  if (num >= 1 && num <= findings.length) {
    i = num - 1;
  }
  continue;
}
```

Add `readLineInput` helper:
```javascript
function readLineInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => { rl.close(); resolve(line.trim()); });
  });
}
```

(Add `const readline = require('readline');` at top if not already imported.)

- [ ] **Step 2: Add batch quit summary**

At the end of `runInteractive`, before the final summary, if there are skipped findings, show batch action:

```javascript
if (summary.skipped > 0 && process.stdin.isTTY) {
  console.log(`  ${summary.skipped} finding(s) were skipped.`);
  const batchAction = await promptChoice(
    ['i', 'l', 'q'],
    () => {
      process.stdout.write(
        `  ${c(useColor, BOLD, '[i]')} Ignore all skipped  ` +
        `${c(useColor, BOLD, '[l]')} Leave as-is  ` +
        `${c(useColor, BOLD, '[q]')} Quit\n`
      );
      process.stdout.write('  > ');
    }
  );
  if (batchAction === 'i') {
    for (let idx = 0; idx < findings.length; idx++) {
      if (!actions.has(idx)) {
        addToGateIgnore(findings[idx].ruleId, findings[idx].file, repoDir);
        summary.ignored++;
        summary.skipped--;
      }
    }
    console.log(`  ${c(useColor, GREEN, '✓')} Added ${summary.ignored} entries to .gateignore`);
  }
}
```

After the batch quit block and summary printout, ensure the function returns:
```javascript
return { summary, modifiedFiles };
```

- [ ] **Step 3: Write tests for navigation features**

Add to `src/cli/__tests__/interactive.test.js`:

```javascript
describe('interactive navigation', () => {
  test('runInteractive returns summary and modifiedFiles', async () => {
    // Mock stdin to auto-skip all findings
    // (The existing test infrastructure should support this)
    const { runInteractive } = require('../interactive');
    // With no TTY, all actions resolve to null (skip)
    const findings = [
      { ruleId: 'test-rule', ruleName: 'Test', severity: 'low', file: '/tmp/test.js', lineNumber: 1 },
    ];
    const result = await runInteractive(findings, { color: false });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('modifiedFiles');
    expect(Array.isArray(result.modifiedFiles)).toBe(true);
    expect(result.summary.skipped).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/cli/__tests__/interactive.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/interactive.js src/cli/__tests__/interactive.test.js
git commit -m "feat: add pagination, back-navigation, and batch actions to interactive mode"
```

---

## Task 15: Config Hierarchy

**Files:**
- Modify: `src/cli/config.js` (add loadUserConfig, merge logic)
- Test: `src/cli/__tests__/config.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('config hierarchy', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  test('loads user config from ~/.config/gate/config.yaml', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-home-'));
    const configDir = path.join(tmpHome, '.config', 'gate');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.yaml'), 'entropy_threshold: 3.5');

    const { loadUserConfig } = require('../config');
    const userConfig = loadUserConfig(tmpHome);
    expect(userConfig.entropy_threshold).toBe('3.5'); // raw from YAML

    fs.rmSync(tmpHome, { recursive: true });
  });

  test('project config overrides user config for severity', () => {
    const { mergeConfigs } = require('../config');
    const user = { severity: { 'aws-access-key-id': 'high' }, output: { color: true } };
    const project = { severity: { 'aws-access-key-id': 'critical' } };
    const merged = mergeConfigs(user, project);
    expect(merged.severity['aws-access-key-id']).toBe('critical');
  });

  test('deep merges output settings', () => {
    const { mergeConfigs } = require('../config');
    const user = { output: { color: true, context_lines: 3 } };
    const project = { output: { format: 'sarif' } };
    const merged = mergeConfigs(user, project);
    expect(merged.output.color).toBe(true);
    expect(merged.output.context_lines).toBe(3);
    expect(merged.output.format).toBe('sarif');
  });

  test('missing user config returns empty object', () => {
    const { loadUserConfig } = require('../config');
    const config = loadUserConfig('/nonexistent/path');
    expect(config).toEqual({});
  });
});
```

- [ ] **Step 2: Implement loadUserConfig and mergeConfigs**

Add to `src/cli/config.js`:

```javascript
const os = require('os');

// Keys that get deep-merged (display/behavior preferences)
const DEEP_MERGE_KEYS = new Set(['output', 'hooks']);

function loadUserConfig(homeDir) {
  homeDir = homeDir || os.homedir();
  const configPath = path.join(homeDir, '.config', 'gate', 'config.yaml');

  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw, { schema: yaml.FAILSAFE_SCHEMA });
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function mergeConfigs(userConfig, projectConfig) {
  const result = { ...userConfig };

  for (const key of Object.keys(projectConfig)) {
    if (DEEP_MERGE_KEYS.has(key) && typeof result[key] === 'object' && typeof projectConfig[key] === 'object') {
      result[key] = { ...result[key], ...projectConfig[key] };
    } else {
      result[key] = projectConfig[key];
    }
  }

  return result;
}
```

Update `loadConfig` to call `loadUserConfig` and merge:

```javascript
function loadConfig(dir) {
  dir = dir || process.cwd();

  // Load user-level config
  const rawUserConfig = loadUserConfig();

  // Load project-level config
  let rawProjectConfig = {};
  const configPath = path.join(dir, '.gaterc');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = yaml.load(raw, { schema: yaml.FAILSAFE_SCHEMA });
      if (parsed && typeof parsed === 'object') {
        rawProjectConfig = parsed;
      }
    } catch (err) {
      console.error(`gate: Invalid .gaterc: ${err.message}. Run 'gate init' to generate a valid config.`);
    }
  }

  // Merge: user defaults < project overrides
  const userConfig = mergeConfigs(rawUserConfig, rawProjectConfig);

  // ... rest of existing loadConfig (custom rules, coercion, return) ...
}
```

Export: `loadUserConfig, mergeConfigs`

- [ ] **Step 3: Run tests**

Run: `npx jest src/cli/__tests__/config.test.js -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/config.js src/cli/__tests__/config.test.js
git commit -m "feat: add config hierarchy with user-level ~/.config/gate/config.yaml"
```

---

## Task 16: Fortress Signing Improvement

**Files:**
- Modify: `rules/fortress.js` (key derivation)
- Modify: `src/cli/rules.js` (runtime verification)
- Test: `src/cli/__tests__/rules.test.js`

- [ ] **Step 1: Implement version-independent key derivation in fortress.js**

Replace the hardcoded key in `signRules` and `verifySignature`:

```javascript
function getDerivedKey() {
  if (process.env.FORTRESS_SIGNING_KEY) {
    return process.env.FORTRESS_SIGNING_KEY;
  }
  // Derive from package identity (version-independent)
  const pkg = require('../package.json');
  const identity = pkg.name + (pkg.author || '');
  const hash = crypto.createHash('sha256').update(identity).digest('hex');
  return crypto.createHmac('sha256', 'gate-fortress-' + hash).digest('hex');
}
```

Replace all occurrences of `process.env.FORTRESS_SIGNING_KEY || 'gate-fortress-dev-key'` with `getDerivedKey()`.

- [ ] **Step 2: Add runtime verification to rules.js**

In `rules/fortress.js`, export `getDerivedKey`:
```javascript
module.exports = { signRules, verifySignature, getDerivedKey, /* existing exports */ };
```

In `src/cli/rules.js`, import and use it (avoid duplicating the key derivation logic):

```javascript
function verifyRuleSignature() {
  try {
    const rulesPath = path.join(__dirname, '../../rules/rules.json');
    const sigPath = rulesPath + '.sig';
    if (!fs.existsSync(sigPath)) return; // No signature file — skip

    const { getDerivedKey } = require('../../rules/fortress');
    const data = fs.readFileSync(rulesPath, 'utf8');
    const sig = fs.readFileSync(sigPath, 'utf8').trim();

    const expected = crypto.createHmac('sha256', getDerivedKey())
      .update(data).digest('hex');

    if (sig !== expected) {
      console.error('gate: Rule file signature mismatch — rules may have been modified. Run \'gate update\' to restore.');
    }
  } catch {
    // Don't block scanning on verification errors
  }
}
```

Call `verifyRuleSignature()` once during module initialization.

- [ ] **Step 3: Re-sign rules.json with new derived key**

Run: `node -e "const f = require('./rules/fortress'); f.signRules('./rules/rules.json', './rules/rules.json.sig');"`

- [ ] **Step 4: Write test**

Add to `src/cli/__tests__/rules.test.js`:

```javascript
test('does not error on rule signature verification', () => {
  // Just verify the module loads without throwing
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  // Force re-require to trigger verification
  jest.resetModules();
  require('../rules');
  // Should not have printed signature mismatch (we just re-signed)
  const sigWarnings = consoleSpy.mock.calls.filter(c => c[0]?.includes?.('signature mismatch'));
  expect(sigWarnings).toHaveLength(0);
  consoleSpy.mockRestore();
});
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/cli/__tests__/rules.test.js -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add rules/fortress.js src/cli/rules.js rules/rules.json.sig src/cli/__tests__/rules.test.js
git commit -m "feat: improve fortress signing with derived key and runtime verification"
```

---

## Task 17: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write CHANGELOG.md**

```markdown
# Changelog

All notable changes to Gate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-XX-XX

Complete rewrite from SaaS to pure CLI. Gate is now free, forever.

### Added
- Zero-config CLI secret scanner — works out of the box with `npx @penumbraforge/gate`
- 281 detection rules (FORTRESS engine) covering AWS, GCP, Azure, GitHub, Stripe, Slack, and 50+ more providers
- Auto-fix engine across 9 languages (JS/TS, Python, Go, Ruby, Java, YAML, Terraform, JSON, Dockerfile)
- Credential verification for 23 providers — confirms if detected secrets are live
- Interactive remediation TUI with exposure-aware actions
- Incident response workflow — 5-step guided process for compromised secrets
- Compliance reports with OWASP Top 10, NIST SP 800-53, CIS Controls, SOC 2 mappings
- SARIF 2.1.0 output for GitHub Code Scanning / GitHub Advanced Security
- Git history scanning and purge script generation
- Local secret vault with AES-256-GCM encryption
- Append-only audit log with SHA-256 integrity chain
- Pre-commit and pre-push git hook installation
- `.gaterc` YAML configuration with custom rules and severity overrides
- `.gateignore` with glob patterns, rule-scoped suppression, and inline `gate-ignore` comments
- Progress spinner with per-file scan feedback
- Per-command `--help` flag support
- User-level config at `~/.config/gate/config.yaml`
- File size guard (default 2MB) to prevent OOM on large files
- Robust Node.js resolution in hooks (nvm, fnm, volta, asdf support)
- `--changed` flag for pre-push scope (scan only upstream diff)
- Multiline secret detection (base64 blocks, template literals)
- Interactive mode pagination with back-navigation and batch actions
- GitHub Action for CI/CD integration

### Removed
- All SaaS infrastructure (Express backend, React frontend, Prisma/PostgreSQL, Redis/BullMQ, Stripe billing, OAuth)
- Authentication, licensing, and billing — Gate is now completely free
- Cloud-dependent features — everything runs locally

### Security
- Cryptographic rule signing (FORTRESS engine) with runtime verification
- Audit log integrity chain (SHA-256)
- Vault encryption (AES-256-GCM) for local secret storage
- Zero runtime dependencies beyond js-yaml
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md for v2.0.0 launch"
```

---

## Task 18: CI/CD Workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (add badge)

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, v2-clean]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test

      - name: Self-scan
        run: node bin/gate.js scan --all
```

- [ ] **Step 2: Add badge to README.md**

At the very top of README.md, before the first heading:

```markdown
[![CI](https://github.com/penumbraforge/gate/actions/workflows/ci.yml/badge.svg)](https://github.com/penumbraforge/gate/actions/workflows/ci.yml)
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: add GitHub Actions workflow with Node 18/20/22 matrix"
```

---

## Task 19: npm Publish Config

**Files:**
- Modify: `package.json` (prepublishOnly script, files audit)

- [ ] **Step 1: Add prepublishOnly script**

In `package.json` scripts:
```json
"prepublishOnly": "npm test && node bin/gate.js scan --all"
```

- [ ] **Step 2: Verify files array excludes test/dev files**

Current files array is correct:
```json
["bin", "src/cli", "!src/cli/__tests__", "rules", "README.md", "LICENSE"]
```

Add `CHANGELOG.md`:
```json
["bin", "src/cli", "!src/cli/__tests__", "rules", "README.md", "LICENSE", "CHANGELOG.md"]
```

- [ ] **Step 3: Dry-run pack to verify tarball**

Run: `npm pack --dry-run 2>&1`
Expected: Lists files, no test files, no .env, size < 500KB

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add prepublishOnly safety net and CHANGELOG to published files"
```

---

## Task 20: README Refresh

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README installation section**

Replace any `@penumbra/gate` references with `@penumbraforge/gate`. Update:
- Installation commands: `npm install -g @penumbraforge/gate` / `npx @penumbraforge/gate`
- Quick start section
- GitHub Action references if they point to old org

- [ ] **Step 2: Add "What happens on first run" section**

After the Quick Start section, add:

```markdown
### What happens on first run

```
$ npx @penumbraforge/gate

  ┌─────────────────────────────────────────┐
  │  Gate v2.0.0 — secret scanner + fixer   │
  │                                         │
  │  ✓ Pre-commit hook installed            │
  │  ✓ 281 detection rules loaded           │
  │  ✓ Zero config needed                   │
  │                                         │
  │  Scanning your repo now...              │
  └─────────────────────────────────────────┘

  ✓ Scanned 387 files in 1.2s
```

That's it. Every commit is now protected.
```

- [ ] **Step 3: Mention --help**

In the Commands section, add note:
```markdown
> **Tip:** Run `gate <command> --help` for detailed usage of any command.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: refresh README for @penumbraforge/gate launch"
```

---

## Task 21: Self-Scan Validation

**Files:** None (validation step)

- [ ] **Step 1: Run self-scan**

Run: `node bin/gate.js scan --all`
Expected: Zero findings

- [ ] **Step 2: Fix any findings introduced by new code**

If any findings appear (e.g., high-entropy strings in help text, example patterns in test code), add appropriate entries to `.gateignore`.

- [ ] **Step 3: Run full test suite**

Run: `npx jest -v`
Expected: All tests pass, 440+ tests (386 original + ~60 new)

- [ ] **Step 4: Verify npm pack**

Run: `npm pack --dry-run 2>&1 | tail -5`
Expected: Tarball size under 500KB, no unexpected files

- [ ] **Step 5: Commit any .gateignore additions**

```bash
git add .gateignore
git commit -m "chore: update .gateignore for launch-readiness changes"
```

---

## Task 22: Final Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Test first-run experience in a fresh repo**

```bash
cd /tmp && mkdir gate-test-repo && cd gate-test-repo && git init
echo 'const key = "sk_live_abc123def456ghi789jkl012";' > secret.js
git add . && npx /path/to/gate
```

Expected: Welcome banner appears, hook installed, scan runs, finding detected.

- [ ] **Step 2: Test pre-commit hook blocks commit**

```bash
git commit -m "test"
```

Expected: Gate scans staged files, finds secret, blocks commit with menu (fix/interactive/abort).

- [ ] **Step 3: Test fix flow allows commit**

Press `f` at the menu.
Expected: Secret extracted to .env, source rewritten, re-scan passes, exit 0, commit succeeds.

- [ ] **Step 4: Test --help on all commands**

```bash
node bin/gate.js scan --help
node bin/gate.js fix --help
node bin/gate.js vault --help
node bin/gate.js --help
```

Expected: Each shows relevant help text.

- [ ] **Step 5: Test --changed flag**

```bash
git checkout -b test-branch
echo "test" > new.txt && git add new.txt && git commit -m "add"
node bin/gate.js scan --changed
```

Expected: Only scans files changed since upstream (or falls back to --all).

- [ ] **Step 6: Clean up**

```bash
cd / && rm -rf /tmp/gate-test-repo
```

---

## Dependency Graph

Tasks 1-4 (Layer 1) must complete before Tasks 5-8 (Layer 2).
Tasks 5-8 must complete before Tasks 9-16 (Layer 3).
Tasks 9-16 must complete before Tasks 17-21 (Layer 4).
Task 22 runs after everything else.

Within each layer, some tasks can run in parallel where they modify different files. File conflicts must be resolved sequentially:

- **Layer 1**: Task 1 (package.json only) can run first alone. Then Task 2 (scanner + config), Task 3 (bin/gate.js + interactive), Task 4 (error messages across many files). Tasks 2 and 4 both touch scanner.js; Tasks 3 and 4 both touch bin/gate.js — **run Tasks 2, 3, 4 sequentially**.
- **Layer 2**: Tasks 5-8 all touch output.js and/or bin/gate.js — **run sequentially** (5 → 6 → 7 → 8).
- **Layer 3**: Task 9 (ignore.js) || Task 11 (installer.js) || Task 13 (scanner.js) can run in parallel. Task 10 and 15 both touch config.js — sequential. Task 12 depends on Task 11. Task 14 depends on Task 3's return value. Task 16 touches rules.js + fortress.js (independent).
- **Layer 4**: Tasks 17-20 are independent. Task 21 depends on all others. Task 22 runs last.
