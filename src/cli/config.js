const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Parse a human-readable file size string into bytes
 *
 * @param {number|string} value - Size value (e.g., 2048, '5MB', '100KB')
 * @returns {number} Size in bytes
 */
function parseFileSize(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(kb|k|mb|m|gb|g|b)?$/i);
    if (match) {
      const num = parseFloat(match[1]);
      const unit = (match[2] || 'b').toUpperCase();
      if (isNaN(num) || num <= 0) return DEFAULT_MAX_FILE_SIZE;
      switch (unit) {
        case 'KB': case 'K': return Math.round(num * 1024);
        case 'MB': case 'M': return Math.round(num * 1024 * 1024);
        case 'GB': case 'G': return Math.round(num * 1024 * 1024 * 1024);
        default: return Math.round(num);
      }
    }
  }
  return DEFAULT_MAX_FILE_SIZE;
}

const DEFAULTS = {
  entropy_threshold: 4.8,
  verify: true,
  hooks: ['pre-commit'],
  severity: {},
  rules: [],
  max_file_size: DEFAULT_MAX_FILE_SIZE,
  output: {
    format: 'text',
    color: 'auto',
    context_lines: 2,
  },
};

// Keys that get deep-merged (display/behavior preferences)
const DEEP_MERGE_KEYS = new Set(['output', 'severity']);

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

  // FAILSAFE_SCHEMA treats all values as strings, so coerce numeric and boolean values
  const parseNum = (val, fallback) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? fallback : n; }
    return fallback;
  };
  const parseBool = (val, fallback) => {
    if (typeof val === 'boolean') return val;
    if (val === 'false') return false;
    if (val === 'true') return true;
    return fallback;
  };

  return {
    entropy_threshold: parseNum(userConfig.entropy_threshold, DEFAULTS.entropy_threshold),
    verify: parseBool(userConfig.verify, DEFAULTS.verify),
    hooks: Array.isArray(userConfig.hooks)
      ? userConfig.hooks : DEFAULTS.hooks,
    severity: (userConfig.severity && typeof userConfig.severity === 'object')
      ? userConfig.severity : DEFAULTS.severity,
    rules: customRules,
    max_file_size: parseFileSize(userConfig.max_file_size),
    output: {
      format: userConfig.output?.format || DEFAULTS.output.format,
      color: parseBool(userConfig.output?.color, DEFAULTS.output.color),
      context_lines: parseNum(userConfig.output?.context_lines, DEFAULTS.output.context_lines),
    },
  };
}

function detectStack(dir) {
  dir = dir || process.cwd();
  const stacks = [];
  const checks = [
    { file: 'package.json', stack: 'node' },
    { file: 'requirements.txt', stack: 'python' },
    { file: 'pyproject.toml', stack: 'python' },
    { file: 'setup.py', stack: 'python' },
    { file: 'go.mod', stack: 'go' },
    { file: 'Gemfile', stack: 'ruby' },
    { file: 'Cargo.toml', stack: 'rust' },
    { file: 'pom.xml', stack: 'java' },
    { file: 'build.gradle', stack: 'java' },
    { file: 'build.gradle.kts', stack: 'java' },
  ];

  for (const { file, stack } of checks) {
    if (fs.existsSync(path.join(dir, file)) && !stacks.includes(stack)) {
      stacks.push(stack);
    }
  }

  // Check for .NET projects by extension
  if (!stacks.includes('dotnet')) {
    try {
      const files = fs.readdirSync(dir);
      if (files.some(f => f.endsWith('.sln') || f.endsWith('.csproj'))) {
        stacks.push('dotnet');
      }
    } catch { /* ignore */ }
  }

  return stacks;
}

function getDefaultIgnorePatterns(stacks) {
  const patterns = [];
  const stackPatterns = {
    node: ['node_modules/**', '*.min.js', '*.bundle.js', 'dist/**', 'build/**', 'coverage/**'],
    python: ['venv/**', '__pycache__/**', '.tox/**', '*.pyc', '.eggs/**'],
    go: ['vendor/**'],
    ruby: ['vendor/bundle/**'],
    rust: ['target/**'],
    java: ['target/**', 'build/**', '*.class'],
    dotnet: ['bin/**', 'obj/**'],
  };

  for (const stack of stacks) {
    if (stackPatterns[stack]) {
      for (const p of stackPatterns[stack]) {
        if (!patterns.includes(p)) patterns.push(p);
      }
    }
  }

  patterns.push('.git/**');
  return patterns;
}

module.exports = { loadConfig, loadUserConfig, mergeConfigs, detectStack, getDefaultIgnorePatterns, DEFAULTS, parseFileSize, DEFAULT_MAX_FILE_SIZE };
