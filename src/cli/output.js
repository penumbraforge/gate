const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const RED_BG = '\x1b[41m\x1b[37m';
const GREEN = '\x1b[32m';

const SEVERITY_COLORS = { critical: RED, high: YELLOW, medium: CYAN, low: DIM };

function redactSecret(match) {
  if (!match || match.length <= 8) return '****';
  return match.slice(0, 4) + '****' + match.slice(-4);
}

function shouldUseColor(setting) {
  if (process.env.NO_COLOR) return false;
  if (setting === true) return true;
  if (setting === false) return false;
  return process.stdout.isTTY || false;
}

function formatSeverity(severity, useColor) {
  const label = severity.toUpperCase();
  if (!useColor) return label;
  const color = SEVERITY_COLORS[severity] || DIM;
  return `${BOLD}${color}${label}${RESET}`;
}

function formatCodeContext(lines, lineNum, contextLines, useColor) {
  const start = Math.max(0, lineNum - 1 - contextLines);
  const end = Math.min(lines.length, lineNum + contextLines);
  const gutterWidth = String(end).length;
  const out = [];

  for (let i = start; i < end; i++) {
    const num = String(i + 1).padStart(gutterWidth);
    const isFindingLine = (i === lineNum - 1);
    const prefix = isFindingLine
      ? `${useColor ? BOLD : ''}  ${num}   `
      : `${useColor ? DIM : ''}  ${num}   `;
    const suffix = useColor ? RESET : '';
    out.push(`${prefix}${lines[i]}${suffix}`);
  }
  return out.join('\n');
}

function formatUnderline(matchStart, matchLength, gutterWidth, useColor) {
  if (matchStart === undefined || matchLength === undefined) return '';
  const pad = ' '.repeat(gutterWidth + 4 + matchStart);
  const mark = '\u203e'.repeat(matchLength);
  if (useColor) return `  ${pad}${RED}${mark}${RESET}`;
  return `  ${pad}${mark}`;
}

function formatVerificationBadge(verification, useColor) {
  if (!verification) return '';
  const status = typeof verification === 'string' ? verification : verification.status;
  if (status === 'live') return useColor ? ` ${RED}${BOLD}VERIFIED LIVE${RESET}` : ' VERIFIED LIVE';
  if (status === 'inactive') return useColor ? ` ${GREEN}INACTIVE${RESET}` : ' INACTIVE';
  return ''; // Don't show badge for unknown/skipped/timeout
}

function formatExposureLabel(exposure, useColor) {
  if (!exposure) return '';
  const level = typeof exposure === 'string' ? exposure : exposure.level;
  const labels = { LOCAL: 'LOCAL ONLY', COMMITTED: 'COMMITTED', PUSHED: 'COMPROMISED', UNKNOWN: 'UNKNOWN' };
  const label = labels[level] || level;
  if (!useColor) return ` [${label}]`;
  if (level === 'LOCAL') return ` ${GREEN}[${label}]${RESET}`;
  if (level === 'COMMITTED') return ` ${YELLOW}[${label}]${RESET}`;
  if (level === 'PUSHED') return ` ${RED}${BOLD}[${label}]${RESET}`;
  return ` ${DIM}[${label}]${RESET}`;
}

function formatFinding(finding, fileLines, options) {
  const useColor = options.color !== undefined ? options.color : false;
  const contextLines = options.context_lines || 2;
  const parts = [];

  const loc = `${finding.file || 'unknown'}:${finding.lineNumber}`;
  parts.push(`  ${useColor ? BOLD : ''}${loc}${useColor ? RESET : ''}`);

  if (fileLines && fileLines.length > 0) {
    // Redact secret in the finding line before rendering code context
    let displayLines = fileLines;
    if (finding.match && finding.lineNumber >= 1 && finding.lineNumber <= fileLines.length) {
      displayLines = [...fileLines];
      const lineIdx = finding.lineNumber - 1;
      displayLines[lineIdx] = displayLines[lineIdx].replace(finding.match, redactSecret(finding.match));
    }
    parts.push(formatCodeContext(displayLines, finding.lineNumber, contextLines, useColor));
    if (finding.matchStart !== undefined) {
      const gutterWidth = String(Math.min(fileLines.length, finding.lineNumber + contextLines)).length;
      parts.push(formatUnderline(finding.matchStart, finding.matchLength, gutterWidth, useColor));
    }
  }

  const sev = formatSeverity(finding.severity || 'medium', useColor);
  const verBadge = formatVerificationBadge(finding.verification, useColor);
  const expLabel = formatExposureLabel(finding.exposure, useColor);
  parts.push(`  ${finding.ruleName || finding.ruleId} \u2500\u2500 ${sev}${verBadge}${expLabel}`);

  if (finding.remediation) {
    parts.push(`  ${useColor ? DIM : ''}${finding.remediation}${useColor ? RESET : ''}`);
  }

  return parts.join('\n');
}

function formatHeader(count, useColor) {
  const label = count === 1 ? '1 secret found' : `${count} secrets found`;
  const line = '\u2500'.repeat(50);
  if (useColor) {
    return `\n  ${BOLD}gate${RESET} ${DIM}\u2500\u2500${RESET} ${RED}${label}${RESET} ${DIM}${line.slice(label.length + 10)}${RESET}\n`;
  }
  return `\n  gate \u2500\u2500 ${label} ${line.slice(label.length + 10)}\n`;
}

function formatSummary(counts, useColor, extra = {}) {
  const parts = [];
  const items = [];
  if (counts.critical > 0) items.push(`${counts.critical} critical`);
  if (counts.high > 0) items.push(`${counts.high} high`);
  if (counts.medium > 0) items.push(`${counts.medium} medium`);
  if (counts.low > 0) items.push(`${counts.low} low`);

  const line = useColor ? `${DIM}${'\u2500'.repeat(50)}${RESET}` : '\u2500'.repeat(50);
  parts.push(`  ${line}`);
  if (counts.total === 0) {
    const suffix = [];
    if (extra.fileCount) suffix.push(`in ${extra.fileCount} files`);
    if (extra.elapsed) suffix.push(`${extra.elapsed}s`);
    const suffixStr = suffix.length > 0 ? ` — ${suffix.join(', ')}` : '';
    parts.push(`  ${useColor ? GREEN : ''}no secrets found${suffixStr}${useColor ? RESET : ''}`);
  } else {
    const suffix = [];
    if (extra.fileCount) suffix.push(`in ${extra.fileCount} files`);
    if (extra.elapsed) suffix.push(`${extra.elapsed}s`);
    const suffixStr = suffix.length > 0 ? ` — ${suffix.join(', ')}` : '';
    parts.push(`  commit blocked \u00b7 ${items.join(' \u00b7 ')}${suffixStr}`);
    parts.push('');
    parts.push('  run gate fix to auto-remediate');
    parts.push('  run gate scan --interactive for guided walkthrough');
  }
  parts.push(`  ${line}`);
  return parts.join('\n');
}

function formatForCI(finding, platform) {
  if (platform === 'github-actions') {
    return `::error file=${finding.file},line=${finding.lineNumber}::${finding.ruleName} (${finding.severity})`;
  }
  return `ERROR: ${finding.file}:${finding.lineNumber} ${finding.ruleName} (${finding.severity})`;
}

function detectCI() {
  if (process.env.GITHUB_ACTIONS) return 'github-actions';
  if (process.env.GITLAB_CI) return 'gitlab-ci';
  if (process.env.CIRCLECI) return 'circleci';
  if (process.env.CI) return 'ci';
  return null;
}

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
    stream.write(`  \x1b[36m${SPINNER_FRAMES[frameIndex]}\x1b[0m ${currentText}`);
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
    },

    succeed(text) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
      stream.write(`  \x1b[32m\u2713\x1b[0m ${text}\n`);
    },

    fail(text) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
      stream.write(`  \x1b[31m\u2717\x1b[0m ${text}\n`);
    },

    stop() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      clear();
    },
  };
}

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

module.exports = {
  shouldUseColor, formatSeverity, formatCodeContext, formatUnderline,
  formatFinding, formatHeader, formatSummary, formatForCI, detectCI,
  formatVerificationBadge, formatExposureLabel, redactSecret, createSpinner,
  formatBanner, formatScanHeader, formatFindingCounter,
  RED, YELLOW, CYAN, DIM, BOLD, RESET, RED_BG, GREEN,
};
