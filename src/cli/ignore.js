const fs = require('fs');
const path = require('path');

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
        if (glob[i + 2] === '/') {
          // **/ — zero or more directories
          regex += '(?:.+/)?';
          i += 3;
        } else if (i + 2 >= glob.length) {
          // ** at end — match everything
          regex += '.*';
          i += 2;
        } else {
          // ** not followed by / — treat as .*
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
        regex += '(?:' + alternatives.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
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
    regex += '(?:/.*)?';
  }

  regex += '$';
  return new RegExp(regex);
}

const RULE_PATTERN_RE = /^\[rule:([^\]]+)\]\s+(.+)$/;
const INLINE_IGNORE_RE = /\/[\/\*]\s*gate-ignore(?::\s*(.+?))?\s*(?:\*\/)?\s*$/;

function loadIgnorePatterns(dir) {
  dir = dir || process.cwd();
  const result = { filePatterns: [], rulePatterns: [], negationPatterns: [] };
  const ignorePath = path.join(dir, '.gateignore');

  if (!fs.existsSync(ignorePath)) return result;

  const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('!')) {
      const negGlob = line.slice(1).trim();
      if (negGlob) {
        try {
          result.negationPatterns.push(globToRegex(negGlob));
        } catch (err) {
          console.error(`gate: Invalid negation pattern in .gateignore: ${line} — ${err.message}. Skipping.`);
        }
      }
      continue;
    }

    const ruleMatch = line.match(RULE_PATTERN_RE);
    if (ruleMatch) {
      const ruleId = ruleMatch[1];
      const glob = ruleMatch[2].trim();
      try {
        result.rulePatterns.push({ ruleId, glob, regex: globToRegex(glob) });
      } catch (err) {
        console.error(`gate: Invalid pattern in .gateignore: [rule:${ruleId}] ${glob} — ${err.message}. Skipping.`);
      }
    } else {
      try {
        result.filePatterns.push(globToRegex(line));
      } catch (err) {
        console.error(`gate: Invalid pattern in .gateignore: ${line} — ${err.message}. Skipping.`);
      }
    }
  }

  return result;
}

function shouldIgnoreFile(filePath, patterns) {
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
