/**
 * FORTRESS rule loader
 *
 * Loads the signed detection rules from rules/rules.json and merges the ones
 * that are NOT already covered by the built-in rules in rules.js into the live
 * rule set. This is what makes the advertised "80 built-in + 68 FORTRESS pack"
 * count real: without this loader, rules.json was only signature-checked and
 * never used for detection.
 *
 * Loading policy:
 *   - rules.json.sig absent  → load anyway (dev clone), warn on stderr
 *   - rules.json.sig valid   → load
 *   - rules.json.sig invalid → skip loading, warn on stderr (scan continues
 *                              with the 80 built-ins)
 *
 * Deduplication drops any rules.json rule whose id OR normalized pattern
 * source already exists among the built-ins.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RULES_JSON_PATH = path.join(__dirname, '../../rules/rules.json');
const RULES_SIG_PATH = RULES_JSON_PATH + '.sig';

/**
 * Map a rules.json category slug to a human-facing provider + category label
 * matching the shape used by the built-in rules.
 */
const CATEGORY_META = {
  'secrets-aws': { provider: 'AWS', category: 'Cloud Credentials' },
  'secrets-gcp': { provider: 'Google Cloud', category: 'Cloud Credentials' },
  'secrets-azure': { provider: 'Azure', category: 'Cloud Credentials' },
  'secrets-cloud': { provider: 'Cloud', category: 'Cloud Credentials' },
  'secrets-github': { provider: 'GitHub', category: 'Authentication Tokens' },
  'secrets-gitlab': { provider: 'GitLab', category: 'Authentication Tokens' },
  'secrets-vcs': { provider: 'VCS', category: 'Authentication Tokens' },
  'secrets-databases': { provider: 'Database', category: 'Database Credentials' },
  'secrets-database': { provider: 'Database', category: 'Database Credentials' },
  'secrets-private-keys': { provider: 'Private Key', category: 'Private Keys' },
  'secrets-stripe': { provider: 'Stripe', category: 'API Keys' },
  'secrets-cicd': { provider: 'CI/CD', category: 'Infrastructure' },
  'secrets-infrastructure': { provider: 'Infrastructure', category: 'Infrastructure' },
  'pii-us': { provider: 'PII', category: 'PII' },
  'code-injection': { provider: 'Code', category: 'Code Injection' },
  'secrets-email': { provider: 'Email', category: 'SaaS Tokens' },
  'secrets-misconfig': { provider: 'Generic', category: 'Misconfiguration' },
  'secrets-comments': { provider: 'Generic', category: 'Generic Secrets' },
  'secrets-encoding': { provider: 'Generic', category: 'Encoding' },
  'secrets-twilio': { provider: 'Twilio', category: 'SaaS Tokens' },
  'secrets-mailgun': { provider: 'Mailgun', category: 'SaaS Tokens' },
  'secrets-slack': { provider: 'Slack', category: 'SaaS Tokens' },
  'secrets-discord': { provider: 'Discord', category: 'SaaS Tokens' },
  'secrets-telegram': { provider: 'Telegram', category: 'SaaS Tokens' },
  'secrets-pagerduty': { provider: 'PagerDuty', category: 'SaaS Tokens' },
  'secrets-datadog': { provider: 'Datadog', category: 'SaaS Tokens' },
  'secrets-newrelic': { provider: 'New Relic', category: 'SaaS Tokens' },
  'secrets-sentry': { provider: 'Sentry', category: 'SaaS Tokens' },
  'secrets-saas': { provider: 'SaaS', category: 'SaaS Tokens' },
  'secrets-ai': { provider: 'AI/ML', category: 'AI/ML Keys' },
  'secrets-registry': { provider: 'Registry', category: 'Registry Tokens' },
  'secrets-token': { provider: 'Generic', category: 'Authentication Tokens' },
  'secrets-generic': { provider: 'Generic', category: 'Generic Secrets' },
};

function titleCase(slug) {
  return String(slug || 'unknown')
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function deriveMeta(categorySlug) {
  if (CATEGORY_META[categorySlug]) return CATEGORY_META[categorySlug];
  const label = titleCase(categorySlug);
  return { provider: label, category: label };
}

/**
 * Normalize a regex pattern source for dedup comparison: strip surrounding
 * flags (patterns are stored flagless) and casefold.
 */
function normalizePattern(source) {
  return String(source).toLowerCase();
}

/**
 * Does a pattern string contain a capturing group? (An unescaped "(" that is
 * not the start of a non-capturing / lookaround group "(?".)
 */
function hasCaptureGroup(patternStr) {
  return /(^|[^\\])\((?!\?)/.test(patternStr);
}

const ASSIGNMENT_SHAPED_RE = /[=:]|key|secret|password|token|credential/i;

let _cache = null;

/**
 * Load, verify, map, and dedup the FORTRESS rules. Result is memoized.
 *
 * @returns {Array} internal-shape rules unique to rules.json (never the builtins)
 */
function loadFortressRules() {
  if (_cache) return _cache;
  _cache = computeFortressRules();
  return _cache;
}

function computeFortressRules() {
  // Lazy require to avoid a load-time cycle with rules.js.
  const { RULES, verifyRuleSignature } = require('./rules');

  let raw;
  try {
    raw = fs.readFileSync(RULES_JSON_PATH, 'utf8');
  } catch {
    // No rules.json at all — nothing to merge.
    return [];
  }

  // Signature gate.
  if (!fs.existsSync(RULES_SIG_PATH)) {
    console.error('gate: rules.json.sig not found — loading FORTRESS rules unsigned (dev mode).');
  } else if (!verifyRuleSignature()) {
    console.error('gate: rules.json signature invalid — skipping FORTRESS rules. Run \'gate update\' to restore.');
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`gate: rules.json is not valid JSON (${err.message}) — skipping FORTRESS rules.`);
    return [];
  }

  const jsonRules = Array.isArray(parsed && parsed.rules) ? parsed.rules : [];

  // Build dedup sets from the built-ins.
  const builtinIds = new Set(RULES.map((r) => r.id));
  const builtinPatterns = new Set(
    RULES.filter((r) => r.pattern instanceof RegExp).map((r) => normalizePattern(r.pattern.source))
  );

  const seenIds = new Set();
  const seenPatterns = new Set();
  const mapped = [];

  for (const jr of jsonRules) {
    if (!jr || typeof jr.id !== 'string' || typeof jr.pattern !== 'string') continue;

    const normPattern = normalizePattern(jr.pattern);

    // Dedup against builtins and against earlier json rules.
    if (builtinIds.has(jr.id) || builtinPatterns.has(normPattern)) continue;
    if (seenIds.has(jr.id) || seenPatterns.has(normPattern)) continue;

    // Compile the pattern; skip (never crash) on invalid regex.
    let regex;
    try {
      regex = new RegExp(jr.pattern);
    } catch (err) {
      console.error(`gate: skipping FORTRESS rule '${jr.id}' — invalid pattern (${err.message}).`);
      continue;
    }

    const meta = deriveMeta(jr.category);
    const rule = {
      id: jr.id,
      name: jr.name || jr.id,
      pattern: regex,
      entropy: false,
      severity: jr.severity || 'medium',
      provider: meta.provider,
      category: meta.category,
      description: jr.description || jr.name || jr.id,
      remediation: jr.remediation || null,
      confidence: typeof jr.confidence === 'number' ? jr.confidence : null,
      source: 'fortress',
    };

    if (hasCaptureGroup(jr.pattern) && ASSIGNMENT_SHAPED_RE.test(jr.pattern)) {
      rule.secretGroup = 1;
    }

    mapped.push(rule);
    seenIds.add(jr.id);
    seenPatterns.add(normPattern);
  }

  return mapped;
}

/**
 * Reset the memoized cache (test-only).
 */
function _resetCache() {
  _cache = null;
}

module.exports = {
  loadFortressRules,
  _resetCache,
  // exported for unit testing
  normalizePattern,
  hasCaptureGroup,
  deriveMeta,
};
