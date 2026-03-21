const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULTS = {
  entropy_threshold: 4.8,
  verify: true,
  hooks: ['pre-commit'],
  severity: {},
  rules: [],
  output: {
    format: 'text',
    color: 'auto',
    context_lines: 2,
  },
};

function loadConfig(dir) {
  dir = dir || process.cwd();
  const configPath = path.join(dir, '.gaterc');
  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = yaml.load(raw, { schema: yaml.FAILSAFE_SCHEMA });
      if (parsed && typeof parsed === 'object') {
        userConfig = parsed;
      }
    } catch (err) {
      // Invalid YAML — fall back to defaults silently
    }
  }

  const customRules = [];
  if (Array.isArray(userConfig.rules)) {
    for (const rule of userConfig.rules) {
      if (!rule.id || !rule.pattern) continue;
      try {
        new RegExp(rule.pattern);
        customRules.push({
          id: rule.id,
          name: rule.name || rule.id,
          pattern: rule.pattern,
          severity: rule.severity || 'medium',
          remediation: rule.remediation || null,
        });
      } catch {
        // Skip rules with invalid regex
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
    output: {
      format: userConfig.output?.format || DEFAULTS.output.format,
      color: userConfig.output?.color ?? DEFAULTS.output.color,
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

module.exports = { loadConfig, detectStack, getDefaultIgnorePatterns, DEFAULTS };
