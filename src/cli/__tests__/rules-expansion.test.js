/**
 * Tests for the rules expansion to 300+ covering modern 2026 services.
 * Verifies rule existence, remediation coverage, and pattern accuracy.
 */

const { getRuleById, getRules } = require('../rules');
const { getRemediation, REMEDIATION_MAP } = require('../remediation');

const NEW_RULE_IDS = [
  'vercel-token',
  'netlify-token',
  'cloudflare-api-key',
  'cloudflare-api-token',
  'linear-api-key',
  'notion-api-key',
  'doppler-token',
  'vault-token',
  'terraform-token',
  'planetscale-token',
  'railway-token',
  'flyio-token',
  'clerk-secret-key',
  'resend-api-key',
  'upstash-token',
  'neon-api-key',
  'turso-token',
  'replicate-token',
  'mistral-api-key',
  'groq-api-key',
  'cohere-api-key',
  'gitlab-pat',
  'gitlab-pipeline-token',
  'postman-api-key',
  'databricks-token',
];

// Known-positive samples for each rule — real token formats, not real secrets
const KNOWN_POSITIVES = {
  'vercel-token': 'VERCEL_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwX',
  'netlify-token': 'nfp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
  'cloudflare-api-key': 'CF_API_KEY=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  'cloudflare-api-token': 'CLOUDFLARE_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_AB',
  'linear-api-key': 'lin_api_00000000000000000000000000000000000000000',
  'notion-api-key': 'ntn_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx',
  'doppler-token': 'dp.st.dev.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
  'vault-token': 'hvs.ABCDEFGHIJKLMNOPQRSTUVWXYZabc',
  'terraform-token': 'ABCDEFabcdefgh.atlasv1.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789AB',
  'planetscale-token': 'pscale_tkn_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde',
  'railway-token': 'RAILWAY_TOKEN=railway_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
  'flyio-token': 'fo1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg',
  'clerk-secret-key': 'sk_live_00000000000000000000000000000000000',
  'resend-api-key': 're_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde',
  'upstash-token': 'UPSTASH_REDIS_REST_TOKEN=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr',
  'neon-api-key': 'NEON_API_KEY=neon_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu',
  'turso-token': 'TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MDAwMDAwMDAsImlkIjoiYWJjZGVmIn0.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01234567890AB',
  'replicate-token': 'r8_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
  'mistral-api-key': 'MISTRAL_API_KEY=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
  'groq-api-key': 'gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx',
  'cohere-api-key': 'COHERE_API_KEY=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
  'gitlab-pat': 'glpat-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'gitlab-pipeline-token': 'glptt-ABCDEFGHIJKLMNOPQRSTUVWXYZabcde',
  'postman-api-key': 'PMAK-ABCDEFGHIJKLMNOPQRSTUVWX-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
  'databricks-token': 'dapia1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
};

describe('New rule IDs exist in the loaded rules', () => {
  for (const ruleId of NEW_RULE_IDS) {
    test(`rule "${ruleId}" exists`, () => {
      const rule = getRuleById(ruleId);
      expect(rule).toBeDefined();
      expect(rule.id).toBe(ruleId);
    });
  }
});

describe('New rules have required fields', () => {
  for (const ruleId of NEW_RULE_IDS) {
    test(`rule "${ruleId}" has required fields`, () => {
      const rule = getRuleById(ruleId);
      expect(rule).toBeDefined();
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(['critical', 'high', 'medium', 'low']).toContain(rule.severity);
      expect(rule.pattern).toBeInstanceOf(RegExp);
    });
  }
});

describe('New rules have matching remediation entries', () => {
  for (const ruleId of NEW_RULE_IDS) {
    test(`rule "${ruleId}" has a remediation entry`, () => {
      const remediation = getRemediation(ruleId);
      expect(remediation).toBeDefined();
      // Must not fall back to default (default action is 'review' with generic guide)
      expect(REMEDIATION_MAP).toHaveProperty(ruleId);
      expect(remediation.action).toBeTruthy();
      expect(remediation.guide.length).toBeGreaterThan(20);
    });
  }
});

describe('New rule patterns match known-positive samples', () => {
  for (const [ruleId, sample] of Object.entries(KNOWN_POSITIVES)) {
    test(`rule "${ruleId}" matches known-positive sample`, () => {
      const rule = getRuleById(ruleId);
      expect(rule).toBeDefined();
      expect(rule.pattern.test(sample)).toBe(true);
    });
  }
});

describe('Total rule count includes new expansion rules', () => {
  test('at least 75 rules are loaded (original ~53 + 25 new)', () => {
    const rules = getRules();
    expect(rules.length).toBeGreaterThanOrEqual(75);
  });

  test('exactly 25 new expansion rule IDs are present', () => {
    const rules = getRules();
    const ruleIds = new Set(rules.map((r) => r.id));
    const found = NEW_RULE_IDS.filter((id) => ruleIds.has(id));
    expect(found.length).toBe(NEW_RULE_IDS.length);
  });
});
