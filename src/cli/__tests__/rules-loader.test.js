'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { RULES, getRules, getRuleById } = require('../rules');
const { loadFortressRules, hasCaptureGroup, normalizePattern } = require('../rules-loader');
const { scanFile } = require('../scanner');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('rules-loader — merge and dedup', () => {
  test('merged rule set = built-ins + unique FORTRESS rules, no dup ids', () => {
    const fortress = loadFortressRules();
    const merged = getRules();

    expect(merged.length).toBe(RULES.length + fortress.length);

    const ids = merged.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no duplicate normalized pattern sources across the merged set', () => {
    const sources = getRules()
      .filter((r) => r.pattern instanceof RegExp)
      .map((r) => normalizePattern(r.pattern.source));
    expect(new Set(sources).size).toBe(sources.length);
  });

  test('FORTRESS rules never collide with a built-in id', () => {
    const builtinIds = new Set(RULES.map((r) => r.id));
    for (const rule of loadFortressRules()) {
      expect(builtinIds.has(rule.id)).toBe(false);
      expect(rule.source).toBe('fortress');
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });

  test('brings the advertised PII rules live (SSN is not a built-in)', () => {
    // us-ssn only exists in rules.json, proving the FORTRESS pack is loaded.
    expect(RULES.find((r) => r.id === 'us-ssn')).toBeUndefined();
    const ssnRule = getRuleById('us-ssn');
    expect(ssnRule).toBeDefined();
    expect(ssnRule.category).toBe('PII');
  });

  test('hasCaptureGroup / normalizePattern helpers behave', () => {
    expect(hasCaptureGroup('foo=(bar)')).toBe(true);
    expect(hasCaptureGroup('foo(?:bar)')).toBe(false);
    expect(hasCaptureGroup('literal')).toBe(false);
    expect(normalizePattern('ABC')).toBe('abc');
  });
});

describe('rules-loader — live PII detection', () => {
  test('a fake SSN in a .txt file is detected by a FORTRESS PII rule', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ssn-'));
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, 'employee record\nSSN: 123-45-6789\n');

    const result = scanFile(file, {});
    fs.rmSync(tmp, { recursive: true, force: true });

    const ids = result.findings.map((f) => f.ruleId);
    expect(ids).toContain('us-ssn');
  });
});

describe('rules-loader — tampered rules.json is rejected', () => {
  test('flipping a byte in rules.json (sig unchanged) skips the FORTRESS pack but keeps scanning', () => {
    // Copy the real rules.json + its .sig into a throwaway temp dir, tamper
    // the COPY, and point the loader at it. This never touches the shared
    // real rules.json — mutating that raced concurrent test workers and made
    // this suite flaky.
    const realRules = path.join(PROJECT_ROOT, 'rules', 'rules.json');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-tamper-'));
    const tamperedPath = path.join(tmp, 'rules.json');
    try {
      const original = fs.readFileSync(realRules, 'utf8');
      // Tampered content the (copied, unchanged) signature won't cover.
      fs.writeFileSync(tamperedPath, original + ' ');
      fs.copyFileSync(realRules + '.sig', tamperedPath + '.sig');

      const { computeFortressRules } = require('../rules-loader');
      const fortress = computeFortressRules(tamperedPath);
      expect(fortress.length).toBe(0);   // tampered pack skipped
      expect(RULES.length).toBe(80);     // built-ins still available
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a valid signed copy loads the FORTRESS pack', () => {
    // Sanity counterpart: the same copy, UNtampered, verifies and loads.
    const realRules = path.join(PROJECT_ROOT, 'rules', 'rules.json');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-valid-'));
    const copyPath = path.join(tmp, 'rules.json');
    try {
      fs.copyFileSync(realRules, copyPath);
      fs.copyFileSync(realRules + '.sig', copyPath + '.sig');

      const { computeFortressRules } = require('../rules-loader');
      const fortress = computeFortressRules(copyPath);
      expect(fortress.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
