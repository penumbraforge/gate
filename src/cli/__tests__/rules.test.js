const {
  RULES,
  getRules,
  getRuleById,
  getRulesBySeverity,
  getPatternRules,
  getEntropyRule,
} = require('../rules');

describe('getRules', () => {
  test('returns an array', () => {
    const rules = getRules();
    expect(Array.isArray(rules)).toBe(true);
  });

  test('returns a non-empty array', () => {
    const rules = getRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  test('every rule has required fields: id, name, severity', () => {
    const rules = getRules();
    for (const rule of rules) {
      expect(rule).toHaveProperty('id');
      expect(typeof rule.id).toBe('string');
      expect(rule.id.length).toBeGreaterThan(0);

      expect(rule).toHaveProperty('name');
      expect(typeof rule.name).toBe('string');
      expect(rule.name.length).toBeGreaterThan(0);

      expect(rule).toHaveProperty('severity');
      expect(['critical', 'high', 'medium', 'low']).toContain(rule.severity);
    }
  });

  test('every rule has either a pattern (RegExp) or entropy flag', () => {
    const rules = getRules();
    for (const rule of rules) {
      const hasPattern = rule.pattern instanceof RegExp;
      const hasEntropy = rule.entropy === true;
      expect(hasPattern || hasEntropy).toBe(true);
    }
  });

  test('all rule ids are unique', () => {
    const rules = getRules();
    const ids = rules.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('returns the same array as RULES constant', () => {
    expect(getRules()).toBe(RULES);
  });
});

describe('getRuleById', () => {
  test('returns a known rule by id', () => {
    const rule = getRuleById('aws-access-key-id');
    expect(rule).toBeDefined();
    expect(rule.id).toBe('aws-access-key-id');
    expect(rule.name).toBe('AWS Access Key ID');
    expect(rule.severity).toBe('critical');
  });

  test('returns undefined for unknown id', () => {
    expect(getRuleById('nonexistent-rule')).toBeUndefined();
  });
});

describe('getRulesBySeverity', () => {
  test('returns only critical rules when filtering by critical', () => {
    const criticals = getRulesBySeverity('critical');
    expect(criticals.length).toBeGreaterThan(0);
    for (const rule of criticals) {
      expect(rule.severity).toBe('critical');
    }
  });

  test('returns only high rules when filtering by high', () => {
    const highs = getRulesBySeverity('high');
    expect(highs.length).toBeGreaterThan(0);
    for (const rule of highs) {
      expect(rule.severity).toBe('high');
    }
  });

  test('returns empty array for non-existent severity', () => {
    expect(getRulesBySeverity('catastrophic')).toEqual([]);
  });
});

describe('getPatternRules', () => {
  test('returns only rules with a non-null pattern', () => {
    const patternRules = getPatternRules();
    for (const rule of patternRules) {
      expect(rule.pattern).not.toBeNull();
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });

  test('excludes the entropy-only rule', () => {
    const patternRules = getPatternRules();
    const entropyOnly = patternRules.find((r) => r.id === 'high-entropy-string');
    expect(entropyOnly).toBeUndefined();
  });

  test('has fewer rules than the full set', () => {
    expect(getPatternRules().length).toBeLessThan(getRules().length);
  });
});

describe('getEntropyRule', () => {
  test('returns the high-entropy-string rule', () => {
    const rule = getEntropyRule();
    expect(rule).toBeDefined();
    expect(rule.id).toBe('high-entropy-string');
    expect(rule.entropy).toBe(true);
    expect(rule.pattern).toBeNull();
    expect(rule.entropyThreshold).toBe(3.8);
  });
});

describe('rule signature verification', () => {
  test('rule signature verification does not error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.resetModules();
    require('../rules');
    const sigWarnings = consoleSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('signature mismatch')
    );
    expect(sigWarnings).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});

describe('rule patterns match expected secrets', () => {
  test('aws-access-key-id pattern matches a valid AKIA key', () => {
    const rule = getRuleById('aws-access-key-id');
    expect(rule.pattern.test('AKIAIOSFODNN7EXAMPLE')).toBe(true);
  });

  test('github-pat pattern matches a ghp_ token', () => {
    const rule = getRuleById('github-pat');
    expect(rule.pattern.test('ghp_ABCDEFabcdef1234567890')).toBe(true);
  });

  test('stripe-live-secret pattern matches sk_live_ key', () => {
    const rule = getRuleById('stripe-live-secret');
    expect(rule.pattern.test('sk_live_00000000000000000000000000')).toBe(true);
  });

  test('private-key-rsa pattern matches RSA header', () => {
    const rule = getRuleById('private-key-rsa');
    expect(rule.pattern.test('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  });

  test('mongodb-uri pattern matches connection string', () => {
    const rule = getRuleById('mongodb-uri');
    expect(rule.pattern.test('mongodb+srv://user:pass@cluster.mongodb.net')).toBe(true);
  });

  test('openai-api-key pattern matches sk- prefix key (48+ chars)', () => {
    const rule = getRuleById('openai-api-key');
    // Real OpenAI keys are 48+ chars after sk- prefix
    expect(rule.pattern.test('sk-' + 'a'.repeat(48))).toBe(true);
    expect(rule.pattern.test('sk-proj-' + 'a'.repeat(48))).toBe(true);
    // Short strings should NOT match (reduces false positives)
    expect(rule.pattern.test('sk-abcdefghijklmnopqrstuvwx')).toBe(false);
  });

  test('aws-access-key-id pattern does not match random text', () => {
    const rule = getRuleById('aws-access-key-id');
    expect(rule.pattern.test('this is not a key')).toBe(false);
  });
});
