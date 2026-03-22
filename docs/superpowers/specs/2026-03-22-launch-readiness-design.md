# Gate v2 Launch Readiness — Design Spec

**Date**: 2026-03-22
**Goal**: Make Gate bulletproof for npm publish as `@penumbraforge/gate`
**Philosophy**: Zero new runtime dependencies unless zero-dep and genuinely better. Hand-roll by default.
**Identity**: `@penumbraforge/gate` on npm, `github.com/penumbraforge/gate` on GitHub.

---

## Layer 1 — Stop the Bleeding

Fixes that prevent crashes, wrong behavior, and broken identity.

### 1.1 File Size Guard

**Problem**: No file size limit. A 100MB minified bundle gets read into memory and scanned, risking OOM.

**Solution**: Add `MAX_FILE_SIZE` constant (default 2MB). Check `fs.statSync(filePath).size` before `readFileSync` in `scanner.js`. Skip with warning on TTY: `"Skipping large-file.min.js (4.2MB > 2MB limit)"`. Silent skip on non-TTY with count in summary.

**Configurable via**:
- `.gaterc`: `max_file_size: 5242880` (bytes)
- CLI: `--max-file-size 5MB` (accepts human-readable)

**Human-readable parser**: Supports `B`, `KB`, `MB`, `GB` (case-insensitive). Also accepts `K`, `M`, `G` without `B` suffix. Numeric-only values treated as bytes. Examples: `"5MB"`, `"5mb"`, `"5M"`, `"512KB"`, `"2048"` (bytes). No binary units (MiB/GiB) — keep it simple.

**Files changed**: `scanner.js`, `config.js`, `bin/gate.js`
**Tests**: Skip on large file, configurable threshold, warning output, human-readable parsing (all unit variants)

### 1.2 Exit Code Fix

**Problem**: Two specific exit code bugs in `bin/gate.js`:
1. **Line 337**: After `--interactive` flag triggers `runInteractive()`, unconditionally exits 1 — even if user fixed all findings during the session.
2. **Line 386**: After user picks `[i]nteractive` from the TTY prompt, `runInteractive()` also unconditionally exits 1.
3. **Line 379**: The `[f]ix` path exits 0 if `fixResult.fixed > 0` — but this is wrong too. It should check if findings *remain*, not if *any* were fixed. Fixing 1 of 5 shouldn't exit 0.

The fix path (lines 366-374) already has re-scan logic for pre-commit re-staging. The interactive path has none.

**Solution**: After both `runInteractive()` call sites (lines 337 and 386), add a re-scan of all originally-scanned files. If re-scan shows zero findings → exit 0. If findings remain → exit 1. Also fix line 379: change from `fixResult.fixed > 0` to re-scan check.

**Logic** (applied to all three exit points):
```
// After interactive or fix session completes:
const residual = scanFiles(originalFiles, scanOptions);
if (residual.totalFindings === 0) {
  // Re-stage in pre-commit mode
  if (isPreCommitHook) {
    execSync(`git add ${modifiedFiles.map(f => `"${f}"`).join(' ')}`);
  }
  process.exit(0);  // all clean
} else {
  process.exit(1);  // findings remain
}
```

`runInteractive()` must return which files it modified so re-scan knows what to check. Currently it doesn't — add a return value `{ modifiedFiles, actions }`.

**Files changed**: `bin/gate.js` (lines 337, 379, 386), `interactive.js` (return modified files)
**Tests**: Interactive fix-all → exit 0, interactive fix-some → exit 1, fix path re-scan, no fix → exit 1

### 1.3 Error Message Overhaul

**Problem**: Generic catch blocks produce vague "unexpected error" messages. Users can't self-diagnose.

**Solution**: Audit every try/catch in the codebase. Replace each with a specific, actionable message that tells the user what failed, why, and what to do.

**Error patterns to fix**:

| Context | Current | New |
|---------|---------|-----|
| `.gaterc` parse | "unexpected error" | `"Invalid .gaterc: <yaml error>. Run 'gate init' to generate a valid config."` |
| File unreadable | Silent skip | `"Cannot read <path>: <reason>"` (dim, non-blocking) |
| Git not found | Crash | `"Git not found. Install git or use 'gate scan <file>' for direct file scanning."` |
| Network in verify | Silent 'unknown' | `"Verify failed for <provider>: <reason>. Use --no-verify to skip."` |
| Malformed .gateignore | Silent | `"Invalid pattern in .gateignore line <n>: <reason>. Skipping."` |
| Hook install fail | Generic | `"Cannot install hook: <reason>. Check .git/hooks/ permissions."` |

**Principle**: Every error has three parts: what failed, why, what to do next. Stack trace available with `DEBUG=1`.

**Files changed**: `bin/gate.js`, `config.js`, `scanner.js`, `verify.js`, `ignore.js`, `installer.js`
**Tests**: Specific error messages for each failure mode

### 1.4 Package Identity

**Problem**: `package.json` has wrong org (`@penumbra/gate`) and repo URL (`github.com/penumbra/gate`).

**Solution**: Update all identity fields:

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

**Files changed**: `package.json`
**Tests**: None (static config)

---

## Layer 2 — The "Wow" Layer

First-impression features that make users want to keep using Gate.

### 2.1 Progress Spinner

**Problem**: `gate scan --all` on large repos goes silent. Users think it hung.

**Solution**: Hand-rolled ANSI spinner in `output.js`. Uses `process.stderr.write` + `\r\x1b[2K` for in-place updates.

**Spinner states**:
- Discovering: `"Discovering files..."`
- Scanning: `"Scanning 142/387 files... (src/cli/scanner.js)"`
- Verifying: `"Verifying 3 credentials..."`
- Complete: `"Scanned 387 files in 1.2s"`

**API**:
```javascript
const spinner = createSpinner();
spinner.start('Discovering files...');
spinner.update(`Scanning ${i}/${total} files... (${filename})`);
spinner.succeed(`Scanned ${total} files in ${elapsed}s`);
spinner.fail('Scan failed: <reason>');
```

**Behavior**:
- Braille characters (`"\\u280b\\u2819\\u2839\\u2838\\u283c\\u2834\\u2826\\u2827\\u2807\\u280f"`) at 80ms interval
- TTY only — non-TTY gets plain start/complete lines (relies on `process.stderr.isTTY` check, NOT `--no-color`)
- Writes to stderr (stdout reserved for structured output like JSON/SARIF)
- `--no-color` affects only ANSI color codes, NOT spinner animation (standard behavior per `NO_COLOR` spec)

**Files changed**: `output.js` (new `createSpinner`), `bin/gate.js` (call spinner)
**Tests**: TTY produces output, non-TTY silent, succeed/fail formatting

### 2.2 First-Run Experience

**Problem**: First `npx @penumbraforge/gate` installs hook and scans, but there's no visual moment. Users don't know what just happened.

**Solution**: Show welcome banner on first hook install only:

```
  ┌─────────────────────────────────────────┐
  │  Gate v2.0.0 — secret scanner + fixer   │
  │                                         │
  │  ✓ Pre-commit hook installed            │
  │  ✓ 281 detection rules loaded           │
  │  ✓ Zero config needed                   │
  │                                         │
  │  Scanning your repo now...              │
  └─────────────────────────────────────────┘
```

**Detection**: Call `isInstalled('pre-commit')` BEFORE calling `install()`. If not installed, proceed with install. If install succeeds AND the pre-check was false (meaning this is a new install, not a replacement), show the banner. This correctly distinguishes first-install from hook-already-present.

**Files changed**: `bin/gate.js` (banner rendering after install), `output.js` (banner helper)
**Tests**: Banner shown on first run, not on subsequent runs

### 2.3 `--help` Flag Support

**Problem**: `gate scan --help` doesn't work. Only `gate help` does. Users expect `--help` and `-h` on every command.

**Solution**: Check for `--help`/`-h` in parsed args. If present, show command-specific help.

**Per-command help**:
- `gate --help` / `gate help` → full command list (existing `printUsage()`)
- `gate scan --help` → scan flags, 3 examples
- `gate fix --help` → fix flags (--dry-run, --undo), examples
- `gate report --help` → report formats, examples
- `gate vault --help` → vault subcommands, examples
- `gate audit --help` → audit subcommands, examples
- `gate install --help` → install/uninstall, hook types
- `gate init --help` → what init does, flags
- `gate status --help` → what status shows
- `gate purge --help` → purge workflow, safety warnings

**Files changed**: `bin/gate.js` (arg parsing + `commandHelp` map)
**Tests**: `--help` produces output for each command, `-h` alias works

### 2.4 Output Polish

**Problem**: Findings display without context framing. No scan header, no numbered findings, no timing.

**Solution**: Three additions:

**Header** (before first finding):
```
Gate v2.0.0 · 281 rules · scanning 387 files
```

**Finding counter**:
```
[1/7] CRITICAL  aws-secret-access-key
```
Instead of bare `CRITICAL  aws-secret-access-key`.

**Summary footer**:
```
── 7 findings in 4 files (3 critical, 2 high, 1 medium, 1 low) ── 1.2s
```

**Files changed**: `output.js` (header, counter, footer functions), `bin/gate.js` (pass count/timing)
**Tests**: Header/footer format, counter numbering, severity breakdown accuracy

---

## Layer 3 — Earn Trust

Reliability hardening for early adopters who push the tool hard.

### 3.1 Glob Parser Rewrite

**Problem**: Hand-rolled `globToRegex()` breaks on `**/*.log`, doesn't support negation or braces.

**Solution**: Rewrite from scratch with correct semantics:
- `*` — match any non-separator characters
- `**` — match zero or more path segments
- `?` — match single non-separator character
- `{a,b}` — brace expansion (one level, no nesting needed)
- `!pattern` — negation (un-ignore)
- Trailing `/` — directory match only
- Proper escaping of `.`, `(`, `)`, `[`, `]`, `+`, `^`, `$`, `|`

**Breaking change note**: The current parser accidentally treats `[abc]` as a regex character class. The rewrite treats `[` and `]` as literal characters (`.gateignore` is not `.gitignore` — we keep it simple). This is intentional: `.gateignore` supports `*`, `**`, `?`, `{a,b}`, `!`, and that's it. Document this in GUIDE.md.

**Test matrix** (15+ cases):
```
"*.js"           → matches "foo.js", not "src/foo.js"
"**/*.js"        → matches "foo.js", "src/foo.js", "a/b/c/foo.js"
"src/**"         → matches "src/a", "src/a/b/c"
"**/test/**"     → matches "test/a", "src/test/a"
"*.{js,ts}"      → matches "foo.js", "foo.ts"
"!important.js"  → un-ignores "important.js"
"dir/"           → matches "dir" as directory
"file.*.js"      → matches "file.test.js"
"[test]"         → literal brackets (not character class)
```

**Files changed**: `ignore.js` (rewrite `globToRegex`, add negation to `shouldIgnoreFile`/`shouldIgnoreFinding`)
**Tests**: New dedicated test suite `glob.test.js` with 15+ cases

### 3.2 Custom Rule Validation Warnings

**Problem**: Invalid regex in `.gaterc` custom rules silently disappears.

**Solution**: On invalid regex, emit visible warning:
```
⚠ Custom rule 'my-pattern': invalid regex — Unterminated group. Skipping.
```

Also validate structure — warn on missing required fields (`id`, `pattern`, `severity`):
```
⚠ Custom rule at index 2: missing 'id' field. Skipping.
```

**Files changed**: `config.js` (add warnings in rule compilation)
**Tests**: Invalid regex warns, missing fields warn, valid rules still load

### 3.3 Hook Robustness

**Problem**: Hook script uses bare `command -v node`. Fails for nvm, fnm, asdf, volta users.

**Solution**: Replace with resolution chain in hook template:

```sh
find_gate_node() {
  # Explicit override
  [ -n "$GATE_NODE_PATH" ] && [ -x "$GATE_NODE_PATH" ] && echo "$GATE_NODE_PATH" && return
  # Standard PATH
  command -v node 2>/dev/null && return
  # nvm
  [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && command -v node 2>/dev/null && return
  # fnm
  [ -x "$HOME/.fnm/fnm" ] && eval "$("$HOME/.fnm/fnm" env)" && command -v node 2>/dev/null && return
  # volta
  [ -x "$HOME/.volta/bin/node" ] && echo "$HOME/.volta/bin/node" && return
  # Common paths
  for p in /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$p" ] && echo "$p" && return
  done
  return 1
}
```

Failure message: `"Gate: Node.js not found. Install Node 18+ or set GATE_NODE_PATH=/path/to/node"`

**Files changed**: `installer.js` (hook template)
**Tests**: Hook template contains resolution chain, GATE_NODE_PATH respected

### 3.4 Pre-Push Scope Option

**Problem**: Pre-push hook runs `gate scan --all` — scans entire repo before every push. Slow on monorepos.

**Solution**: Add a `--changed` flag to `gate scan`. When passed, Gate runs `git diff --name-only @{upstream}...HEAD` internally to get the file list, instead of `--all` or `--staged`. Falls back to `--all` if no upstream exists (first push) or if the git command fails.

The pre-push hook template in `installer.js` changes from:
```sh
$GATE_BIN scan --all
```
to:
```sh
$GATE_BIN scan --changed
```

This keeps all logic inside `gate scan` (not in the shell template), making it testable and debuggable.

**Configurable via** `.gaterc`:
```yaml
hooks:
  pre_push_scope: changed  # changed (default) | all
```

If set to `all`, the hook template uses `--all` instead of `--changed`.

**Files changed**: `installer.js` (hook template uses `--changed`), `config.js` (new config key), `bin/gate.js` (new `--changed` flag handler with git diff logic), `scanner.js` (accept file list from `--changed` resolver)
**Tests**: `--changed` resolves files from upstream diff, fallback to `--all` on no upstream, config override to `all`

### 3.5 Multiline Secret Detection

**Problem**: Line-by-line scanning misses secrets in template literals, concatenated strings, and multiline base64.

**Solution**: Add `extractMultilineStrings()` pre-pass in `scanner.js`. Runs on full file content before line-by-line scan. Extracts candidate strings, then checks each against BOTH entropy AND pattern rules (not entropy alone — pure entropy on joined strings has high false-positive rate).

**Extraction targets**:
1. **Template literals** (JS/TS): Content between backticks, skip `${...}` interpolations, check remaining
2. **Concatenated strings**: Detect `"..." + "..."` or `'...' + '...'` patterns, join parts
3. **Base64 blocks**: 3+ consecutive lines of `[A-Za-z0-9+/=]{20,}`, join

**False-positive mitigation**: Extracted strings are only flagged if:
- They match an existing pattern rule (e.g., AKIA prefix, BEGIN PRIVATE KEY), OR
- They have entropy > threshold AND appear in an assignment context (`=`, `:`, `key`, `secret`, `password`, `token` within 1 line of the start)

This prevents normal string concatenation (`"Hello " + "world"`) from triggering.

**Performance guard**: Only run multiline extraction on files under 500KB (configurable). Files above this are already line-scanned; the marginal benefit of multiline detection on huge files isn't worth the cost. Multiline pass is O(N) on file content (single regex scan, no backtracking).

Findings from multiline detection include the starting line number and a `multiline: true` flag.

**Files changed**: `scanner.js` (new `extractMultilineStrings` function, integrated before line scan)
**Tests**: Template literal secrets, concatenated secrets, base64 blocks, non-secret template literals ignored, assignment-context filter, large-file skip

### 3.6 Interactive Mode Pagination

**Problem**: 100 findings = 100 sequential prompts. No way to navigate, jump, or batch-act.

**Solution**: Add navigation and batch actions:

**Navigation keys**:
- `n` / `s` — next (existing skip, aliased)
- `p` — previous finding
- `j` — jump to number (`"Jump to [1-47]: "`)
- `q` — quit with summary

**Header per finding**:
```
── Finding 3 of 47 ─────────────────────────────
```

**Quit summary with batch action**:
```
Session: 5 fixed, 2 ignored, 1 vaulted, 39 skipped
[i] Ignore all 39 skipped  [l] Leave as-is  [q] Quit
```

**Files changed**: `interactive.js` (navigation state, key handlers, quit summary)
**Tests**: Previous navigation, jump-to, batch ignore, session summary accuracy

### 3.7 Config Hierarchy

**Problem**: Only project-level `.gaterc`. No user-level defaults.

**Solution**: Three-level config, merged top-down:
1. `~/.config/gate/config.yaml` — user defaults (entropy threshold, format, color)
2. `.gaterc` — project overrides (rules, severity, hooks)
3. CLI flags — highest priority

**Merge strategy**: Deep merge for `output` and `hooks` (display/behavior settings where users want personal defaults preserved). Shallow replace for `severity`, `rules`, and `ignore` (policy settings where the project should have full control). CLI flags override individual values at any depth.

Example: user config `output: { color: true, context_lines: 3 }` + project `.gaterc` `output: { format: "sarif" }` → merged result `output: { color: true, context_lines: 3, format: "sarif" }`.

**Files changed**: `config.js` (new `loadUserConfig`, merge logic)
**Tests**: User config loaded, project overrides user, CLI overrides project, missing user config is fine

### 3.8 Fortress Signing Improvement

**Problem**: Hardcoded dev key `gate-fortress-dev-key` makes signature verification meaningless. Scanner never verifies signatures at runtime.

**Solution — two changes**:

**Runtime verification**: When `rules.js` loads `rules.json`, call `fortress.verify()`. On mismatch, emit warning:
```
⚠ Rule file signature mismatch — rules may have been modified. Run 'gate update' to restore.
```
Scan continues (don't block on signature failure — could be user's custom rules.json edit). Log to audit trail.

**Key derivation**: Replace hardcoded default with a version-independent derived key: `HMAC-SHA256("gate-fortress-" + sha256(packageJson.name + packageJson.author))`. The key does NOT include `packageVersion` — this avoids re-signing on every version bump. Not truly secure (determined attacker can reverse it from public inputs) but raises the bar from "copy-paste the hardcoded string" to "read the source and recompute." Real production signing uses `FORTRESS_SIGNING_KEY` env var which takes precedence.

Re-sign `rules.json` with the derived key once. Only re-sign when rules are added/modified or when the package name/author changes (which shouldn't happen).

**Files changed**: `rules.js` (verify on load), `fortress.js` (key derivation), `rules/rules.json.sig` (re-signed)
**Tests**: Valid signature passes, tampered file warns, missing signature warns, env var override works

---

## Layer 4 — Ship It

### 4.1 CHANGELOG.md

Create `CHANGELOG.md` following Keep a Changelog format. Cover the full v2 story: what was added, what was removed (SaaS infrastructure), what changed. Date filled at publish time.

**Files created**: `CHANGELOG.md`

### 4.2 CI/CD Workflow

Create `.github/workflows/ci.yml`:
- Trigger: push and PR to main
- Matrix: Node 18, 20, 22 on ubuntu-latest
- Steps: checkout, setup-node, npm install, npm test, gate scan --all (self-scan)
- Add CI badge to README.md

**Files created**: `.github/workflows/ci.yml`
**Files changed**: `README.md` (badge)

### 4.3 npm Publish Config

**package.json additions**:
- `"prepublishOnly": "npm test && node bin/gate.js scan --all"` — safety net on every publish
- Audit `files` array — confirm no test files, no `.env`, no `src/shared/` TypeScript (verified: `src/shared/` is NOT imported by any CLI module at runtime — it's dev-only TypeScript, safe to exclude)
- Run `npm pack --dry-run` to verify tarball contents and size (<500KB)

**Files changed**: `package.json`

### 4.4 Self-Scan Validation

**Execution sequence** (order matters):
1. Bump version in `package.json` if needed
2. Re-derive fortress signing key (key is version-independent, so only needed if rules changed)
3. Re-sign `rules.json` if rules changed
4. Run `gate scan --all` and confirm zero findings
5. Run full test suite

Fix any new findings introduced by our changes before declaring done. This is a validation step, not a code change.

### 4.5 New Tests

Every Layer 1-3 feature gets tests. Target: at least 60 new tests (no upper cap — write what's needed):
- File size guard (skip, configurable, warning)
- Exit code (fix→0, partial→1, none→1)
- Spinner (TTY output, non-TTY silent)
- Glob parser (15+ cases — dedicated suite)
- Hook robustness (resolution chain, GATE_NODE_PATH)
- Multiline detection (template literals, concat, base64)
- Interactive pagination (nav keys, batch actions)
- Config hierarchy (merge, override, missing)
- Error messages (specific per failure)
- First-run banner (shown once, not repeated)
- Per-command help (--help flag, -h alias)

**Files created**: `src/cli/__tests__/glob.test.js`
**Files changed**: All existing test suites extended

### 4.6 README Refresh

- CI badge at top
- Installation uses `@penumbraforge/gate`
- "What happens on first run" section with banner
- Mention `--help` on every command
- Update version references

**Files changed**: `README.md`

---

## Out of Scope

These are real improvements but not launch blockers:
- OS keychain integration for vault (complexity, platform-specific)
- ML-based entropy detection (scope creep)
- Incremental scanning / caching (performance optimization, post-launch)
- Windows-specific path handling (test on Windows post-launch)
- Submodule scanning (niche use case)
- Asymmetric crypto for Fortress (infrastructure overhead)

---

## Execution Order

Each layer is a stable checkpoint. Implementation proceeds Layer 1 → 2 → 3 → 4. Within each layer, items can be parallelized where they touch different files.

**Commit strategy**: One commit per layer (or per item within a layer if the diff is large). All commits by penumbraforge.
