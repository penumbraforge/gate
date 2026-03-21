const fs = require('fs');
const path = require('path');

function globToRegex(glob) {
  let regex = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          regex += '(?:.+/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (c === '.') {
      regex += '\\.';
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

const RULE_PATTERN_RE = /^\[rule:([^\]]+)\]\s+(.+)$/;
const INLINE_IGNORE_RE = /\/[\/\*]\s*gate-ignore(?::\s*(.+?))?\s*(?:\*\/)?\s*$/;

function loadIgnorePatterns(dir) {
  dir = dir || process.cwd();
  const result = { filePatterns: [], rulePatterns: [] };
  const ignorePath = path.join(dir, '.gateignore');

  if (!fs.existsSync(ignorePath)) return result;

  const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const ruleMatch = line.match(RULE_PATTERN_RE);
    if (ruleMatch) {
      const ruleId = ruleMatch[1];
      const glob = ruleMatch[2].trim();
      try {
        result.rulePatterns.push({ ruleId, glob, regex: globToRegex(glob) });
      } catch { /* skip */ }
    } else {
      try {
        result.filePatterns.push(globToRegex(line));
      } catch { /* skip */ }
    }
  }

  return result;
}

function shouldIgnoreFile(filePath, patterns) {
  for (const regex of patterns.filePatterns) {
    if (regex.test(filePath)) return true;
  }
  return false;
}

function shouldIgnoreFinding(ruleId, filePath, patterns) {
  for (const rp of patterns.rulePatterns) {
    if (rp.ruleId === ruleId && rp.regex.test(filePath)) return true;
  }
  return false;
}

function hasInlineIgnore(line) {
  return INLINE_IGNORE_RE.test(line);
}

function getIgnoreReason(line) {
  const match = line.match(INLINE_IGNORE_RE);
  if (match && match[1]) return match[1].trim();
  return null;
}

module.exports = {
  loadIgnorePatterns, shouldIgnoreFile, shouldIgnoreFinding,
  hasInlineIgnore, getIgnoreReason, globToRegex,
};
